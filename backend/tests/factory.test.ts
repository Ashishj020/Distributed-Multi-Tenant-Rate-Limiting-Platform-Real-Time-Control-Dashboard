import { describe, expect, it } from "vitest";
import { StrategyFactory } from "../src/algorithms/factory.js";
import { sharedRedis } from "./helpers.js";

describe("StrategyFactory", () => {
  it("selects interchangeable strategies without if/else in the caller", async () => {
    const redis = await sharedRedis();
    const factory = new StrategyFactory(redis, "token_bucket");
    expect(factory.get().id).toBe("token_bucket");
    factory.set("sliding_window_log");
    expect(factory.get().id).toBe("sliding_window_log");
    factory.set("sliding_window_counter");
    expect(factory.get().id).toBe("sliding_window_counter");
  });

  it("rejects unknown algorithm names", async () => {
    const redis = await sharedRedis();
    const factory = new StrategyFactory(redis, "token_bucket");
    expect(() => factory.resolve("leaky_bucket")).toThrow(/Unknown algorithm/);
  });
});
