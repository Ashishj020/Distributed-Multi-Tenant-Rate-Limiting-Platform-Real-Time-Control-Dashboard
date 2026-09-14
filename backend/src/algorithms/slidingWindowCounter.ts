import Redis from "ioredis";
import type { RateLimitConfig } from "../config/tenants.js";
import { stateKey, stateTtlSeconds } from "../redis/scripts.js";
import type { RateLimitResult, RateLimitStrategy } from "./types.js";
import { asInt } from "./types.js";

interface RedisWithSlidingCounter extends Redis {
  slidingCounterCheck(
    key: string,
    nowMs: number,
    windowMs: number,
    limit: number,
    ttl: number
  ): Promise<[number | string, number | string, number | string, string]>;
}

export class SlidingWindowCounterStrategy implements RateLimitStrategy {
  readonly id = "sliding_window_counter" as const;

  constructor(private readonly redis: Redis) {}

  async check(tenantId: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const key = stateKey(this.id, tenantId);
    const nowMs = Date.now();
    const ttl = stateTtlSeconds(this.id, config.windowSeconds);

    const reply = await (this.redis as RedisWithSlidingCounter).slidingCounterCheck(
      key,
      nowMs,
      config.windowSeconds * 1000,
      config.limit,
      ttl
    );

    return {
      allowed: asInt(reply[0]) === 1,
      remaining: Math.max(0, asInt(reply[1])),
      reset_at: asInt(reply[2], Math.floor(nowMs / 1000) + config.windowSeconds),
      limit: config.limit,
      algorithm: this.id,
      tenant_id: tenantId
    };
  }
}
