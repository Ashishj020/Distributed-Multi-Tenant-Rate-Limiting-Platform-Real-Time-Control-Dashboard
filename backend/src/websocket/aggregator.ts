import type { AlgorithmId } from "../config/env.js";
import type { TenantConfig } from "../config/tenants.js";

export type WsEventType =
  | "snapshot"
  | "stats"
  | "rate_limit_decision"
  | "rate_limit_triggered"
  | "algorithm_changed"
  | "tenant_updated"
  | "stress_test_started"
  | "stress_test_progress"
  | "stress_test_completed"
  | "benchmark_updated";

export interface WsEvent {
  type: WsEventType;
  timestamp: number;
  [key: string]: unknown;
}

export interface TenantLiveStats {
  tenant_id: string;
  allowed: number;
  rejected: number;
  remaining: number;
  limit: number;
  utilization: number;
  rps: number;
  last_allowed: boolean | null;
  status: "idle" | "healthy" | "approaching" | "critical" | "limited";
  sparkline: number[];
}

export interface DecisionEvent {
  tenant_id: string;
  allowed: boolean;
  remaining: number;
  limit: number;
  algorithm: AlgorithmId;
  timestamp: number;
}

const SPARK_POINTS = 40;
const STREAM_CAP = 120;

interface TenantAccumulator {
  allowed: number;
  rejected: number;
  remaining: number;
  limit: number;
  windowHits: number[];
  sparkline: number[];
  lastAllowed: boolean | null;
  lastTs: number;
}

export class LiveAggregator {
  private readonly tenants = new Map<string, TenantAccumulator>();
  private allowed = 0;
  private rejected = 0;
  private window: number[] = [];
  private readonly stream: DecisionEvent[] = [];
  private algorithm: AlgorithmId;
  private sampleRate: number;
  private lastFlush = Date.now();

  constructor(algorithm: AlgorithmId, sampleRate: number, tenantConfigs: TenantConfig[]) {
    this.algorithm = algorithm;
    this.sampleRate = sampleRate;
    for (const tenant of tenantConfigs) {
      this.ensure(tenant.tenant_id, tenant.requests_per_window);
    }
  }

  setAlgorithm(algorithm: AlgorithmId): void {
    this.algorithm = algorithm;
  }

  setSampleRate(rate: number): void {
    this.sampleRate = rate;
  }

  resetTraffic(): void {
    this.allowed = 0;
    this.rejected = 0;
    this.window = [];
    this.stream.length = 0;
    for (const acc of this.tenants.values()) {
      acc.allowed = 0;
      acc.rejected = 0;
      acc.windowHits = [];
      acc.sparkline = new Array(SPARK_POINTS).fill(0);
      acc.lastAllowed = null;
    }
  }

  seedTenants(configs: TenantConfig[]): void {
    for (const tenant of configs) {
      const acc = this.ensure(tenant.tenant_id, tenant.requests_per_window);
      acc.limit = tenant.requests_per_window;
      acc.remaining = tenant.requests_per_window;
    }
  }

  record(event: DecisionEvent): DecisionEvent | null {
    const acc = this.ensure(event.tenant_id, event.limit);
    if (event.allowed) {
      this.allowed += 1;
      acc.allowed += 1;
    } else {
      this.rejected += 1;
      acc.rejected += 1;
    }
    acc.remaining = event.remaining;
    acc.limit = event.limit;
    acc.lastAllowed = event.allowed;
    acc.lastTs = event.timestamp;
    acc.windowHits.push(event.timestamp);
    this.window.push(event.timestamp);

    const sampled = Math.random() < this.sampleRate || !event.allowed && Math.random() < 0.2;
    if (sampled) {
      this.stream.unshift(event);
      if (this.stream.length > STREAM_CAP) this.stream.pop();
      return event;
    }
    return null;
  }

  snapshot(now = Date.now()): {
    algorithm: AlgorithmId;
    allowed: number;
    rejected: number;
    rps: number;
    utilization: number;
    tenants: TenantLiveStats[];
    stream: DecisionEvent[];
  } {
    this.prune(now);
    const tenants = [...this.tenants.entries()].map(([tenant_id, acc]) => {
      const rps = acc.windowHits.length;
      const used = acc.limit <= 0 ? 0 : (acc.limit - acc.remaining) / acc.limit;
      const utilization = Math.max(0, Math.min(2, used));
      acc.sparkline.push(rps);
      if (acc.sparkline.length > SPARK_POINTS) acc.sparkline.shift();
      return {
        tenant_id,
        allowed: acc.allowed,
        rejected: acc.rejected,
        remaining: acc.remaining,
        limit: acc.limit,
        utilization,
        rps,
        last_allowed: acc.lastAllowed,
        status: statusFor(utilization, acc.rejected, acc.lastTs, now),
        sparkline: acc.sparkline.slice()
      } satisfies TenantLiveStats;
    });

    tenants.sort((a, b) => a.tenant_id.localeCompare(b.tenant_id));
    const rps = this.window.length;
    const weightedUtil =
      tenants.length === 0
        ? 0
        : tenants.reduce((sum, t) => sum + Math.min(t.utilization, 1), 0) / tenants.length;

    return {
      algorithm: this.algorithm,
      allowed: this.allowed,
      rejected: this.rejected,
      rps,
      utilization: weightedUtil,
      tenants,
      stream: this.stream.slice(0, 80)
    };
  }

  private ensure(tenantId: string, limit: number): TenantAccumulator {
    let acc = this.tenants.get(tenantId);
    if (!acc) {
      acc = {
        allowed: 0,
        rejected: 0,
        remaining: limit,
        limit,
        windowHits: [],
        sparkline: new Array(SPARK_POINTS).fill(0),
        lastAllowed: null,
        lastTs: 0
      };
      this.tenants.set(tenantId, acc);
    }
    return acc;
  }

  private prune(now: number): void {
    const cutoff = now - 1000;
    this.window = this.window.filter((ts) => ts >= cutoff);
    for (const acc of this.tenants.values()) {
      acc.windowHits = acc.windowHits.filter((ts) => ts >= cutoff);
    }
    this.lastFlush = now;
  }
}

function statusFor(
  utilization: number,
  rejected: number,
  lastTs: number,
  now: number
): TenantLiveStats["status"] {
  if (now - lastTs > 15_000 && rejected === 0 && utilization <= 0) return "idle";
  if (utilization >= 1 || rejected > 0 && utilization >= 0.98) return "limited";
  if (utilization >= 0.85) return "critical";
  if (utilization >= 0.6) return "approaching";
  return "healthy";
}
