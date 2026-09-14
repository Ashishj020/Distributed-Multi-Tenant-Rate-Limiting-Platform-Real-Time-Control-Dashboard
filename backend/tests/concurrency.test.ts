import { describe, expect, it } from "vitest";
import { SlidingWindowCounterStrategy } from "../src/algorithms/slidingWindowCounter.js";
import { SlidingWindowLogStrategy } from "../src/algorithms/slidingWindowLog.js";
import { TokenBucketStrategy } from "../src/algorithms/tokenBucket.js";
import { flushTenant, sharedRedis, uniqueTenant } from "./helpers.js";

describe("distributed concurrency", () => {
  it("keeps sliding window log totals consistent under concurrent clients", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("dist_log");
    await flushTenant(redis, tenantId);
    const strategy = new SlidingWindowLogStrategy(redis);
    const config = { tenantId, limit: 40, windowSeconds: 60, burstCapacity: 40 };

    const results = await Promise.all(
      Array.from({ length: 200 }, () => strategy.check(tenantId, config))
    );
    const allowed = results.filter((r) => r.allowed).length;
    const rejected = results.filter((r) => !r.allowed).length;
    expect(allowed + rejected).toBe(200);
    expect(allowed).toBe(40);
  });

  it("does not let token bucket exceed burst capacity under concurrent load", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("dist_tb");
    await flushTenant(redis, tenantId);
    const strategy = new TokenBucketStrategy(redis);
    const config = { tenantId, limit: 30, windowSeconds: 60, burstCapacity: 15 };

    const results = await Promise.all(
      Array.from({ length: 120 }, () => strategy.check(tenantId, config))
    );
    const allowed = results.filter((r) => r.allowed).length;
    const rejected = results.filter((r) => !r.allowed).length;
    expect(allowed + rejected).toBe(120);
    expect(allowed).toBeLessThanOrEqual(15);
    expect(allowed).toBeGreaterThan(0);
  });

  it("keeps sliding window counter within a small bound of the configured limit", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("dist_ctr");
    await flushTenant(redis, tenantId);
    const strategy = new SlidingWindowCounterStrategy(redis);
    const config = { tenantId, limit: 35, windowSeconds: 60, burstCapacity: 35 };

    const results = await Promise.all(
      Array.from({ length: 150 }, () => strategy.check(tenantId, config))
    );
    const allowed = results.filter((r) => r.allowed).length;
    const rejected = results.filter((r) => !r.allowed).length;
    expect(allowed + rejected).toBe(150);
    expect(allowed).toBeLessThanOrEqual(35);
    expect(allowed).toBeGreaterThan(0);
  });
});
