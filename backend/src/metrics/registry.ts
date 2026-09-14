import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry
} from "prom-client";

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: "rate_limiter_" });

  const checksTotal = new Counter({
    name: "rate_limit_checks_total",
    help: "Total rate-limit checks",
    labelNames: ["algorithm", "tenant_id"] as const,
    registers: [registry]
  });

  const allowedTotal = new Counter({
    name: "rate_limit_allowed_total",
    help: "Allowed rate-limit decisions",
    labelNames: ["algorithm"] as const,
    registers: [registry]
  });

  const rejectedTotal = new Counter({
    name: "rate_limit_rejected_total",
    help: "Rejected rate-limit decisions",
    labelNames: ["algorithm"] as const,
    registers: [registry]
  });

  const checkDuration = new Histogram({
    name: "rate_limit_check_duration_seconds",
    help: "Rate-limit check latency including Redis",
    labelNames: ["algorithm"] as const,
    buckets: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
    registers: [registry]
  });

  const redisDuration = new Histogram({
    name: "redis_operation_duration_seconds",
    help: "Redis command latency observed by the limiter",
    labelNames: ["op"] as const,
    buckets: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1],
    registers: [registry]
  });

  const activeTenants = new Gauge({
    name: "active_tenants",
    help: "Number of configured tenants",
    registers: [registry]
  });

  const redisUp = new Gauge({
    name: "rate_limiter_redis_up",
    help: "1 if Redis is reachable",
    registers: [registry]
  });

  return {
    registry,
    checksTotal,
    allowedTotal,
    rejectedTotal,
    checkDuration,
    redisDuration,
    activeTenants,
    redisUp
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
