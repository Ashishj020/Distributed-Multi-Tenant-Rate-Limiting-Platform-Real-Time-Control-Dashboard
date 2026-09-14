import Redis from "ioredis";
import type { AlgorithmId } from "../config/env.js";
import { isAlgorithmId } from "../config/env.js";
import { REDIS_KEYS } from "../config/keys.js";
import { SlidingWindowCounterStrategy } from "./slidingWindowCounter.js";
import { SlidingWindowLogStrategy } from "./slidingWindowLog.js";
import { TokenBucketStrategy } from "./tokenBucket.js";
import type { RateLimitStrategy } from "./types.js";

export class StrategyFactory {
  private current: AlgorithmId;
  private readonly strategies: Record<AlgorithmId, RateLimitStrategy>;

  constructor(redis: Redis, initial: AlgorithmId) {
    this.current = initial;
    this.strategies = {
      token_bucket: new TokenBucketStrategy(redis),
      sliding_window_log: new SlidingWindowLogStrategy(redis),
      sliding_window_counter: new SlidingWindowCounterStrategy(redis)
    };
  }

  get(): RateLimitStrategy {
    return this.strategies[this.current];
  }

  currentId(): AlgorithmId {
    return this.current;
  }

  set(algorithm: AlgorithmId): void {
    this.current = algorithm;
  }

  resolve(value: string): AlgorithmId {
    if (!isAlgorithmId(value)) {
      throw new Error(`Unknown algorithm '${value}'`);
    }
    return value;
  }

  async persist(redis: Redis, algorithm: AlgorithmId): Promise<void> {
    this.set(algorithm);
    await redis.set(REDIS_KEYS.algorithm, algorithm);
  }

  async restore(redis: Redis, fallback: AlgorithmId): Promise<AlgorithmId> {
    const stored = await redis.get(REDIS_KEYS.algorithm);
    if (stored && isAlgorithmId(stored)) {
      this.set(stored);
      return stored;
    }
    this.set(fallback);
    await redis.set(REDIS_KEYS.algorithm, fallback);
    return fallback;
  }
}
