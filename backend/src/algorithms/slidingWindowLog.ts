import { randomBytes } from "node:crypto";
import Redis from "ioredis";
import type { RateLimitConfig } from "../config/tenants.js";
import { stateKey, stateTtlSeconds } from "../redis/scripts.js";
import type { RateLimitResult, RateLimitStrategy } from "./types.js";
import { asInt } from "./types.js";

interface RedisWithSlidingLog extends Redis {
  slidingLogCheck(
    key: string,
    nowMs: number,
    windowMs: number,
    limit: number,
    ttl: number,
    requestId: string
  ): Promise<[number | string, number | string, number | string, number | string]>;
}

export class SlidingWindowLogStrategy implements RateLimitStrategy {
  readonly id = "sliding_window_log" as const;

  constructor(private readonly redis: Redis) {}

  async check(tenantId: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const key = stateKey(this.id, tenantId);
    const nowMs = Date.now();
    const ttl = stateTtlSeconds(this.id, config.windowSeconds);
    const requestId = `${nowMs}:${randomBytes(4).toString("hex")}`;

    const reply = await (this.redis as RedisWithSlidingLog).slidingLogCheck(
      key,
      nowMs,
      config.windowSeconds * 1000,
      config.limit,
      ttl,
      requestId
    );

    return {
      allowed: asInt(reply[0]) === 1,
      remaining: Math.max(0, asInt(reply[1])),
      reset_at: asInt(reply[2], Math.floor((nowMs + config.windowSeconds * 1000) / 1000)),
      limit: config.limit,
      algorithm: this.id,
      tenant_id: tenantId
    };
  }
}
