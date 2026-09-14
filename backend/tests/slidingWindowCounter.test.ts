import { describe, expect, it } from "vitest";
import { SlidingWindowCounterStrategy } from "../src/algorithms/slidingWindowCounter.js";
import { REDIS_KEYS } from "../src/config/keys.js";
import { flushTenant, sharedRedis, uniqueTenant } from "./helpers.js";

describe("SlidingWindowCounterStrategy", () => {
  it("enforces the configured limit in a single window", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("ctr_limit");
    await flushTenant(redis, tenantId);
    const strategy = new SlidingWindowCounterStrategy(redis);
    const config = { tenantId, limit: 10, windowSeconds: 30, burstCapacity: 10 };

    const results = [];
    for (let i = 0; i < 12; i += 1) {
      results.push(await strategy.check(tenantId, config));
    }
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(10);
    expect(results[10]?.allowed).toBe(false);
    expect(results[0]?.algorithm).toBe("sliding_window_counter");
  });

  it("stores previous and current window counters for interpolation", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("ctr_weight");
    await flushTenant(redis, tenantId);
    const strategy = new SlidingWindowCounterStrategy(redis);
    const config = { tenantId, limit: 100, windowSeconds: 2, burstCapacity: 100 };

    for (let i = 0; i < 8; i += 1) {
      await strategy.check(tenantId, config);
    }

    const key = REDIS_KEYS.state("sliding_window_counter", tenantId);
    const state = await redis.hgetall(key);
    expect(Number(state.count)).toBeGreaterThanOrEqual(8);
    expect(state.window).toBeDefined();
    expect(state.prev_window).toBeDefined();
  });

  it("transitions between adjacent windows without losing the previous count", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("ctr_transition");
    await flushTenant(redis, tenantId);
    const strategy = new SlidingWindowCounterStrategy(redis);
    const config = { tenantId, limit: 50, windowSeconds: 1, burstCapacity: 50 };

    for (let i = 0; i < 6; i += 1) {
      await strategy.check(tenantId, config);
    }
    const key = REDIS_KEYS.state("sliding_window_counter", tenantId);
    const before = await redis.hgetall(key);
    const firstWindow = before.window;

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const next = await strategy.check(tenantId, config);
    expect(next.allowed).toBe(true);

    const after = await redis.hgetall(key);
    expect(after.window).not.toBe(firstWindow);
    expect(Number(after.prev_count)).toBeGreaterThanOrEqual(6);
    expect(Number(after.count)).toBe(1);
  });

  it("weighted count stays near the limit rather than doubling at a window edge", async () => {
    const redis = await sharedRedis();
    const tenantId = uniqueTenant("ctr_edge");
    await flushTenant(redis, tenantId);
    const strategy = new SlidingWindowCounterStrategy(redis);
    const config = { tenantId, limit: 8, windowSeconds: 1, burstCapacity: 8 };

    let allowed = 0;
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      if ((await strategy.check(tenantId, config)).allowed) allowed += 1;
    }
    // Across ~1.5 windows the approximate limiter should not admit a full 2x limit.
    expect(allowed).toBeGreaterThanOrEqual(8);
    expect(allowed).toBeLessThan(16);
  });
});
