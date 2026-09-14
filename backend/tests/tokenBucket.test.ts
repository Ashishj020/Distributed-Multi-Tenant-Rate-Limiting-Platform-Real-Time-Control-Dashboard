import { describe, expect, it } from "vitest";
import { TokenBucketStrategy } from "../src/algorithms/tokenBucket.js";
import { flushTenant, sharedRedis, uniqueTenant } from "./helpers.js";

describe("TokenBucketStrategy", () => {
  it("allows requests while tokens exist and consumes them", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("tb_consume");
    await flushTenant(redis, tenantId);
    const strategy = new TokenBucketStrategy(redis);
    const config = { tenantId, limit: 60, windowSeconds: 60, burstCapacity: 5 };

    const allowed: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
      allowed.push((await strategy.check(tenantId, config)).allowed);
    }
    const sixth = await strategy.check(tenantId, config);

    expect(allowed.every(Boolean)).toBe(true);
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
    expect(sixth.algorithm).toBe("token_bucket");
    expect(sixth.reset_at).toBeGreaterThan(Math.floor(Date.now() / 1000) - 1);
  });

  it("enforces burst capacity and does not exceed it", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("tb_cap");
    await flushTenant(redis, tenantId);
    const strategy = new TokenBucketStrategy(redis);
    const config = { tenantId, limit: 1000, windowSeconds: 60, burstCapacity: 3 };

    const results = await Promise.all(
      Array.from({ length: 8 }, () => strategy.check(tenantId, config))
    );
    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBeLessThanOrEqual(3);
    expect(results.some((r) => !r.allowed)).toBe(true);
  });

  it("refills tokens over time", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("tb_refill");
    await flushTenant(redis, tenantId);
    const strategy = new TokenBucketStrategy(redis);
    const config = { tenantId, limit: 10, windowSeconds: 1, burstCapacity: 1 };

    const first = await strategy.check(tenantId, config);
    const immediate = await strategy.check(tenantId, config);
    expect(first.allowed).toBe(true);
    expect(immediate.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const afterRefill = await strategy.check(tenantId, config);
    expect(afterRefill.allowed).toBe(true);
  });

  it("handles a burst then throttles to refill rate", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("tb_burst");
    await flushTenant(redis, tenantId);
    const strategy = new TokenBucketStrategy(redis);
    const config = { tenantId, limit: 20, windowSeconds: 2, burstCapacity: 4 };

    let allowed = 0;
    for (let i = 0; i < 4; i += 1) {
      if ((await strategy.check(tenantId, config)).allowed) allowed += 1;
    }
    expect(allowed).toBe(4);
    expect((await strategy.check(tenantId, config)).allowed).toBe(false);
  });
});
