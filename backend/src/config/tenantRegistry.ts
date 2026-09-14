import Redis from "ioredis";
import { REDIS_KEYS } from "../config/keys.js";
import {
  buildDefaultTenants,
  type TenantConfig,
  type TrafficProfile
} from "../config/tenants.js";

const PROFILE_VALUES = new Set<TrafficProfile>(["low", "normal", "heavy", "burst"]);

export class TenantRegistry {
  private readonly tenants = new Map<string, TenantConfig>();

  constructor(private readonly redis: Redis) {}

  async load(): Promise<void> {
    const ids = await this.redis.smembers(REDIS_KEYS.tenantSet);
    if (ids.length === 0) {
      await this.seed(buildDefaultTenants(50));
      return;
    }
    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.hgetall(REDIS_KEYS.tenant(id));
    }
    const results = await pipeline.exec();
    this.tenants.clear();
    (results ?? []).forEach((entry: [Error | null, unknown] | null, index: number) => {
      const raw = (entry?.[1] ?? {}) as Record<string, string>;
      const parsed = deserializeTenant(raw, ids[index]);
      if (parsed) this.tenants.set(parsed.tenant_id, parsed);
    });
    if (this.tenants.size === 0) {
      await this.seed(buildDefaultTenants(50));
    }
  }

  async seed(tenants: TenantConfig[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const tenant of tenants) {
      pipeline.sadd(REDIS_KEYS.tenantSet, tenant.tenant_id);
      pipeline.hset(REDIS_KEYS.tenant(tenant.tenant_id), serializeTenant(tenant));
      this.tenants.set(tenant.tenant_id, tenant);
    }
    await pipeline.exec();
  }

  get(tenantId: string): TenantConfig | undefined {
    return this.tenants.get(tenantId);
  }

  list(): TenantConfig[] {
    return [...this.tenants.values()].sort((a, b) =>
      a.tenant_id.localeCompare(b.tenant_id)
    );
  }

  size(): number {
    return this.tenants.size;
  }

  async upsert(patch: Partial<TenantConfig> & { tenant_id: string }): Promise<TenantConfig> {
    const existing = this.tenants.get(patch.tenant_id);
    const next: TenantConfig = {
      tenant_id: patch.tenant_id,
      requests_per_window: patch.requests_per_window ?? existing?.requests_per_window ?? 100,
      window_size: patch.window_size ?? existing?.window_size ?? 60,
      burst_capacity: patch.burst_capacity ?? existing?.burst_capacity ?? 40,
      enabled: patch.enabled ?? existing?.enabled ?? true,
      traffic_profile: patch.traffic_profile ?? existing?.traffic_profile ?? "normal"
    };
    if (next.requests_per_window <= 0 || next.window_size <= 0 || next.burst_capacity <= 0) {
      throw new Error("Tenant limits must be positive");
    }
    this.tenants.set(next.tenant_id, next);
    await this.redis.sadd(REDIS_KEYS.tenantSet, next.tenant_id);
    await this.redis.hset(REDIS_KEYS.tenant(next.tenant_id), serializeTenant(next));
    return next;
  }
}

function serializeTenant(tenant: TenantConfig): Record<string, string> {
  return {
    tenant_id: tenant.tenant_id,
    requests_per_window: String(tenant.requests_per_window),
    window_size: String(tenant.window_size),
    burst_capacity: String(tenant.burst_capacity),
    enabled: tenant.enabled ? "1" : "0",
    traffic_profile: tenant.traffic_profile
  };
}

function deserializeTenant(
  raw: Record<string, string>,
  fallbackId: string
): TenantConfig | null {
  const tenant_id = raw.tenant_id || fallbackId;
  if (!tenant_id) return null;
  const profile = PROFILE_VALUES.has(raw.traffic_profile as TrafficProfile)
    ? (raw.traffic_profile as TrafficProfile)
    : "normal";
  return {
    tenant_id,
    requests_per_window: Number(raw.requests_per_window || 100),
    window_size: Number(raw.window_size || 60),
    burst_capacity: Number(raw.burst_capacity || 40),
    enabled: raw.enabled !== "0",
    traffic_profile: profile
  };
}
