import type { RateLimitConfig } from "../config/tenants.js";
import type { AlgorithmId } from "../config/env.js";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset_at: number;
  limit: number;
  algorithm: AlgorithmId;
  tenant_id: string;
}

export interface RateLimitStrategy {
  readonly id: AlgorithmId;
  check(tenantId: string, config: RateLimitConfig): Promise<RateLimitResult>;
}

export function asInt(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}
