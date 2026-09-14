export type TrafficProfile = "low" | "normal" | "heavy" | "burst";

export interface TenantConfig {
  tenant_id: string;
  requests_per_window: number;
  window_size: number;
  burst_capacity: number;
  enabled: boolean;
  traffic_profile: TrafficProfile;
}

export interface RateLimitConfig {
  tenantId: string;
  limit: number;
  windowSeconds: number;
  burstCapacity: number;
}

export function toRateLimitConfig(tenant: TenantConfig): RateLimitConfig {
  return {
    tenantId: tenant.tenant_id,
    limit: tenant.requests_per_window,
    windowSeconds: tenant.window_size,
    burstCapacity: tenant.burst_capacity
  };
}

const WINDOW_SECONDS = 60;

type Spec = {
  requestsPerWindow: number;
  burstCapacity: number;
  profile: TrafficProfile;
};

function specForIndex(index: number): Spec {
  // Explicit examples from the spec for the first four tenants.
  if (index === 1) return { requestsPerWindow: 100, burstCapacity: 40, profile: "normal" };
  if (index === 2) return { requestsPerWindow: 500, burstCapacity: 180, profile: "heavy" };
  if (index === 3) return { requestsPerWindow: 1000, burstCapacity: 350, profile: "heavy" };
  if (index === 4) return { requestsPerWindow: 50, burstCapacity: 20, profile: "low" };

  // Remaining 46 tenants: ~70% normal, ~20% heavy, ~10% burst (of the full 50).
  // 01-04 already assigned; of 46 left we want roughly 33 normal, 8 heavy, 5 burst + lows mixed in.
  if (index <= 8) return { requestsPerWindow: 50, burstCapacity: 20, profile: "low" };
  if (index <= 38) {
    const rpm = index % 3 === 0 ? 200 : 100;
    return { requestsPerWindow: rpm, burstCapacity: Math.round(rpm * 0.4), profile: "normal" };
  }
  if (index <= 45) {
    return { requestsPerWindow: 500, burstCapacity: 180, profile: "heavy" };
  }
  return { requestsPerWindow: 250, burstCapacity: 250, profile: "burst" };
}

export function buildDefaultTenants(count = 50): TenantConfig[] {
  const tenants: TenantConfig[] = [];
  for (let i = 1; i <= count; i += 1) {
    const spec = specForIndex(i);
    tenants.push({
      tenant_id: `tenant_${String(i).padStart(2, "0")}`,
      requests_per_window: spec.requestsPerWindow,
      window_size: WINDOW_SECONDS,
      burst_capacity: spec.burstCapacity,
      enabled: true,
      traffic_profile: spec.profile
    });
  }
  return tenants;
}

export const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidTenantId(value: string): boolean {
  return TENANT_ID_PATTERN.test(value);
}
