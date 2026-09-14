import Redis from "ioredis";
import type { RateLimitConfig } from "../config/tenants.js";
import { stateKey, stateTtlSeconds } from "../redis/scripts.js";
import type { RateLimitResult, RateLimitStrategy } from "./types.js";
import { asInt } from "./types.js";

interface RedisWithTokenBucket extends Redis {
  tokenBucketCheck(
    key: string,
    capacity: number,
    refillPerSec: number,
    nowMs: number,
    ttl: number,
    cost: number
  ): Promise<[number | string, number | string, number | string, string]>;
}

export class TokenBucketStrategy implements RateLimitStrategy {
  readonly id = "token_bucket" as const;

  constructor(private readonly redis: Redis) {}

  async check(tenantId: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const key = stateKey(this.id, tenantId);
    const nowMs = Date.now();
    const ttl = stateTtlSeconds(this.id, config.windowSeconds);
    const refillPerSec = config.limit / config.windowSeconds;
    const capacity = Math.max(config.burstCapacity, 1);

    const reply = await (this.redis as RedisWithTokenBucket).tokenBucketCheck(
      key,
      capacity,
      refillPerSec,
      nowMs,
      ttl,
      1
    );

    return {
      allowed: asInt(reply[0]) === 1,
      remaining: Math.max(0, asInt(reply[1])),
      reset_at: asInt(reply[2], Math.floor(nowMs / 1000)),
      limit: config.limit,
      algorithm: this.id,
      tenant_id: tenantId
    };
  }
}
