import type { AlgorithmId } from "./env.js";

export const REDIS_KEYS = {
  algorithm: "ratelimit:config:algorithm",
  tenantSet: "ratelimit:tenants",
  tenant: (tenantId: string) => `ratelimit:tenant:${tenantId}`,
  state: (algorithm: AlgorithmId, tenantId: string) =>
    `ratelimit:${algorithm}:${tenantId}`,
  benchmarks: "ratelimit:benchmarks",
  pubsub: "ratelimit:events"
} as const;

export const ALGORITHM_TTL_MULTIPLIER: Record<AlgorithmId, number> = {
  token_bucket: 3,
  sliding_window_log: 2,
  sliding_window_counter: 3
};

export function stateTtlSeconds(algorithm: AlgorithmId, windowSeconds: number): number {
  const ttl = windowSeconds * ALGORITHM_TTL_MULTIPLIER[algorithm];
  return Math.max(ttl, 120);
}
