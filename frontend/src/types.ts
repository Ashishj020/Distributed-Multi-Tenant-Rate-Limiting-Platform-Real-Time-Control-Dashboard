export type AlgorithmId = "token_bucket" | "sliding_window_log" | "sliding_window_counter";

export type TenantStatus = "idle" | "healthy" | "approaching" | "critical" | "limited";

export interface TenantConfig {
  tenant_id: string;
  requests_per_window: number;
  window_size: number;
  burst_capacity: number;
  enabled: boolean;
  traffic_profile: "low" | "normal" | "heavy" | "burst";
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
  status: TenantStatus;
  sparkline: number[];
}

export interface StreamEvent {
  tenant_id: string;
  allowed: boolean;
  remaining?: number;
  timestamp: number;
  id: string;
}

export interface BenchmarkResult {
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

export const ALGORITHM_LABELS: Record<AlgorithmId, string> = {
  token_bucket: "Token Bucket",
  sliding_window_log: "Sliding Window Log",
  sliding_window_counter: "Sliding Window Counter"
};

export const API_BASE = import.meta.env.VITE_API_BASE || "/api";
export const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY || "change-me-in-production";

export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-admin-key", ADMIN_KEY);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}
