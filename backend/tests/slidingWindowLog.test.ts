import { describe, expect, it } from "vitest";
import { SlidingWindowLogStrategy } from "../src/algorithms/slidingWindowLog.js";
import { flushTenant, sharedRedis, uniqueTenant } from "./helpers.js";

describe("SlidingWindowLogStrategy", () => {
  it("enforces an exact window limit", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("log_limit");
    await flushTenant(redis, tenantId);
    const strategy = new SlidingWindowLogStrategy(redis);
    const config = { tenantId, limit: 3, windowSeconds: 30, burstCapacity: 3 };

    const a = await strategy.check(tenantId, config);
    const b = await strategy.check(tenantId, config);
    const c = await strategy.check(tenantId, config);
    const d = await strategy.check(tenantId, config);

    expect([a, b, c].every((r) => r.allowed)).toBe(true);
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
    expect(c.remaining).toBe(0);
    expect(a.algorithm).toBe("sliding_window_log");
  });

  it("expires timestamps outside the current window", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("log_expire");
    await flushTenant(redis, tenantId);
    const strategy = new SlidingWindowLogStrategy(redis);
    const config = { tenantId, limit: 2, windowSeconds: 1, burstCapacity: 2 };

    expect((await strategy.check(tenantId, config)).allowed).toBe(true);
    expect((await strategy.check(tenantId, config)).allowed).toBe(true);
    expect((await strategy.check(tenantId, config)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const after = await strategy.check(tenantId, config);
    expect(after.allowed).toBe(true);
  });

  it("handles concurrent requests without exceeding the limit", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("log_conc");
    await flushTenant(redis, tenantId);
    const strategy = new SlidingWindowLogStrategy(redis);
    const config = { tenantId, limit: 25, windowSeconds: 60, burstCapacity: 25 };

    const results = await Promise.all(
      Array.from({ length: 80 }, () => strategy.check(tenantId, config))
    );
    const allowed = results.filter((r) => r.allowed).length;
    const rejected = results.filter((r) => !r.allowed).length;
    expect(allowed + rejected).toBe(80);
    expect(allowed).toBe(25);
    expect(rejected).toBe(55);
  });
});
