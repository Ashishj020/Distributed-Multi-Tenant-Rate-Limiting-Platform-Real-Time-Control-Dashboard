import { Agent, request } from "undici";
import type { AlgorithmId } from "../config/env.js";
import type { TenantConfig } from "../config/tenants.js";

export interface StressTestOptions {
  baseUrl: string;
  tenants: TenantConfig[];
  durationSec: number;
  targetRps: number;
  tenantCount: number;
  algorithm: AlgorithmId;
}

export interface StressTestResult {
  algorithm: AlgorithmId;
  duration_sec: number;
  requests: number;
  allowed: number;
  rejected: number;
  errors: number;
  throughput: number;
  latency_avg_ms: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  rejection_rate: number;
  cpu_percent: number;
  memory_rss_mb: number;
  memory_heap_mb: number;
  target_rps: number;
  tenant_count: number;
  completed_at: string;
}

export interface StressProgress {
  elapsed_sec: number;
  requests: number;
  allowed: number;
  rejected: number;
  rps: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildChooser(tenants: TenantConfig[]): () => TenantConfig {
  const weighted: TenantConfig[] = [];
  for (const tenant of tenants) {
    const weight =
      tenant.traffic_profile === "low"
        ? 1
        : tenant.traffic_profile === "normal"
          ? 5
          : tenant.traffic_profile === "heavy"
            ? 12
            : 8;
    for (let i = 0; i < weight; i += 1) weighted.push(tenant);
  }
  const burstTenants = tenants.filter((t) => t.traffic_profile === "burst");

  return () => {
    const second = Math.floor(Date.now() / 1000);
    const inBurst = second % 6 === 0 || second % 6 === 1;
    if (inBurst && burstTenants.length > 0 && Math.random() < 0.35) {
      return burstTenants[Math.floor(Math.random() * burstTenants.length)];
    }
    return weighted[Math.floor(Math.random() * weighted.length)];
  };
}

export async function runStressTest(
  options: StressTestOptions,
  onProgress?: (progress: StressProgress) => void
): Promise<StressTestResult> {
  const tenants = options.tenants.filter((t) => t.enabled).slice(0, options.tenantCount);
  if (tenants.length === 0) {
    throw new Error("No enabled tenants available for stress test");
  }

  const agent = new Agent({
    connections: 64,
    pipelining: 1,
    keepAliveTimeout: 10_000,
    keepAliveMaxTimeout: 30_000
  });

  const choose = buildChooser(tenants);
  const latencies: number[] = [];
  let allowed = 0;
  let rejected = 0;
  let errors = 0;
  let issued = 0;
  let running = true;

  const cpuStart = process.cpuUsage();
  const wallStart = process.hrtime.bigint();
  const startedAt = Date.now();
  const deadline = startedAt + options.durationSec * 1000;
  const workers = Math.min(96, Math.max(8, Math.round(options.targetRps / 80)));

  const progressTimer = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    onProgress?.({
      elapsed_sec: elapsed,
      requests: issued,
      allowed,
      rejected,
      rps: elapsed > 0 ? issued / elapsed : 0
    });
  }, 250);

  async function worker(): Promise<void> {
    while (running && Date.now() < deadline) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const quota = elapsed * options.targetRps;
      if (issued >= quota) {
        await sleep(1);
        continue;
      }
      issued += 1;
      const tenant = choose();
      const t0 = performance.now();
      try {
        const response = await request(
          `${options.baseUrl}/check?tenant_id=${encodeURIComponent(tenant.tenant_id)}`,
          {
            method: "GET",
            dispatcher: agent,
            headersTimeout: 4000,
            bodyTimeout: 4000
          }
        );
        await response.body.dump();
        const latency = performance.now() - t0;
        latencies.push(latency);
        if (response.statusCode === 200) allowed += 1;
        else if (response.statusCode === 429) rejected += 1;
        else errors += 1;
      } catch {
        errors += 1;
        latencies.push(performance.now() - t0);
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: workers }, () => worker()));
  } finally {
    running = false;
    clearInterval(progressTimer);
    await agent.close();
  }

  const durationSec = Math.max((Date.now() - startedAt) / 1000, 0.001);
  latencies.sort((a, b) => a - b);
  const total = allowed + rejected + errors;
  const cpu = process.cpuUsage(cpuStart);
  const wallUs = Number(process.hrtime.bigint() - wallStart) / 1000;
  const cpuPercent = wallUs > 0 ? ((cpu.user + cpu.system) / wallUs) * 100 : 0;
  const memory = process.memoryUsage();

  return {
    algorithm: options.algorithm,
    duration_sec: Number(durationSec.toFixed(2)),
    requests: total,
    allowed,
    rejected,
    errors,
    throughput: Number((total / durationSec).toFixed(1)),
    latency_avg_ms:
      latencies.length === 0
        ? 0
        : Number((latencies.reduce((s, n) => s + n, 0) / latencies.length).toFixed(3)),
    latency_p50_ms: Number(percentile(latencies, 50).toFixed(3)),
    latency_p95_ms: Number(percentile(latencies, 95).toFixed(3)),
    latency_p99_ms: Number(percentile(latencies, 99).toFixed(3)),
    rejection_rate: total === 0 ? 0 : Number((rejected / total).toFixed(4)),
    cpu_percent: Number(cpuPercent.toFixed(1)),
    memory_rss_mb: Number((memory.rss / (1024 * 1024)).toFixed(1)),
    memory_heap_mb: Number((memory.heapUsed / (1024 * 1024)).toFixed(1)),
    target_rps: options.targetRps,
    tenant_count: tenants.length,
    completed_at: new Date().toISOString()
  };
}
