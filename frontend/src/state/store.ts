import { create } from "zustand";
import type {
  AlgorithmId,
  BenchmarkResult,
  StreamEvent,
  TenantConfig,
  TenantLiveStats
} from "./types";

export interface StressState {
  running: boolean;
  elapsed_sec: number;
  requests: number;
  allowed: number;
  rejected: number;
  rps: number;
  duration: number;
  rate: number;
  tenants: number;
}

export interface SwitchToast {
  from: AlgorithmId;
  to: AlgorithmId;
  at: number;
}

interface AppState {
  connected: boolean;
  redis: "up" | "down";
  algorithm: AlgorithmId;
  rps: number;
  allowed: number;
  rejected: number;
  utilization: number;
  tenants: TenantLiveStats[];
  tenantConfigs: TenantConfig[];
  stream: StreamEvent[];
  stress: StressState;
  lastResult: BenchmarkResult | null;
  benchmarks: Partial<Record<AlgorithmId, BenchmarkResult>>;
  toast: SwitchToast | null;
  selectedAlgorithm: AlgorithmId;
  setSelectedAlgorithm: (algorithm: AlgorithmId) => void;
  applyEvent: (event: Record<string, unknown>) => void;
  setConnected: (connected: boolean) => void;
  dismissToast: () => void;
}

const STREAM_LIMIT = 80;

function emptyTenants(): TenantLiveStats[] {
  return Array.from({ length: 50 }, (_, i) => {
    const id = `tenant_${String(i + 1).padStart(2, "0")}`;
    return {
      tenant_id: id,
      allowed: 0,
      rejected: 0,
      remaining: 0,
      limit: 0,
      utilization: 0,
      rps: 0,
      last_allowed: null,
      status: "idle" as const,
      sparkline: new Array(40).fill(0)
    };
  });
}

export const useStore = create<AppState>((set, get) => ({
  connected: false,
  redis: "up",
  algorithm: "token_bucket",
  rps: 0,
  allowed: 0,
  rejected: 0,
  utilization: 0,
  tenants: emptyTenants(),
  tenantConfigs: [],
  stream: [],
  stress: {
    running: false,
    elapsed_sec: 0,
    requests: 0,
    allowed: 0,
    rejected: 0,
    rps: 0,
    duration: 30,
    rate: 4000,
    tenants: 50
  },
  lastResult: null,
  benchmarks: {},
  toast: null,
  selectedAlgorithm: "token_bucket",
  setSelectedAlgorithm: (algorithm) => set({ selectedAlgorithm: algorithm }),
  setConnected: (connected) => set({ connected }),
  dismissToast: () => set({ toast: null }),
  applyEvent: (event) => {
    const type = String(event.type);
    if (type === "snapshot" || type === "stats") {
      const tenants = Array.isArray(event.tenants) ? (event.tenants as TenantLiveStats[]) : get().tenants;
      const algorithm = (event.algorithm as AlgorithmId) || get().algorithm;
      const isSnapshot = type === "snapshot";
      set({
        algorithm,
        selectedAlgorithm:
          isSnapshot && get().selectedAlgorithm === get().algorithm
            ? algorithm
            : get().selectedAlgorithm,
        rps: Number(event.rps ?? get().rps),
        allowed: Number(event.allowed ?? get().allowed),
        rejected: Number(event.rejected ?? get().rejected),
        utilization: Number(event.utilization ?? get().utilization),
        tenants,
        tenantConfigs: Array.isArray(event.tenants_config)
          ? (event.tenants_config as TenantConfig[])
          : get().tenantConfigs,
        benchmarks: event.benchmarks
          ? { ...get().benchmarks, ...(event.benchmarks as AppState["benchmarks"]) }
          : get().benchmarks,
        stream: Array.isArray(event.stream)
          ? (event.stream as StreamEvent[]).map((item, index) => ({
              ...item,
              id: `${item.timestamp}-${index}-${item.tenant_id}`
            }))
          : get().stream
      });
      return;
    }
    if (type === "rate_limit_decision") {
      const next: StreamEvent = {
        tenant_id: String(event.tenant_id),
        allowed: Boolean(event.allowed),
        remaining: Number(event.remaining ?? 0),
        timestamp: Number(event.timestamp ?? Date.now()),
        id: `${event.timestamp}-${event.tenant_id}-${Math.random().toString(36).slice(2, 7)}`
      };
      const stream = [next, ...get().stream].slice(0, STREAM_LIMIT);
      set({ stream });
      return;
    }
    if (type === "algorithm_changed") {
      const to = event.algorithm as AlgorithmId;
      const from = (event.previous as AlgorithmId) || get().algorithm;
      set({
        algorithm: to,
        selectedAlgorithm: to,
        toast: { from, to, at: Date.now() }
      });
      return;
    }
    if (type === "stress_test_started") {
      set({
        stress: {
          ...get().stress,
          running: true,
          elapsed_sec: 0,
          requests: 0,
          allowed: 0,
          rejected: 0,
          rps: 0,
          duration: Number(event.duration ?? get().stress.duration),
          rate: Number(event.rate ?? get().stress.rate),
          tenants: Number(event.tenants ?? get().stress.tenants)
        },
        lastResult: null
      });
      return;
    }
    if (type === "stress_test_progress") {
      set({
        stress: {
          ...get().stress,
          running: true,
          elapsed_sec: Number(event.elapsed_sec ?? 0),
          requests: Number(event.requests ?? 0),
          allowed: Number(event.allowed ?? 0),
          rejected: Number(event.rejected ?? 0),
          rps: Number(event.rps ?? 0)
        }
      });
      return;
    }
    if (type === "stress_test_completed") {
      const result = event.result as BenchmarkResult | undefined;
      set({
        stress: { ...get().stress, running: false },
        lastResult: result ?? get().lastResult,
        benchmarks: result
          ? { ...get().benchmarks, [result.algorithm]: result }
          : get().benchmarks
      });
      return;
    }
    if (type === "benchmark_updated" && event.results) {
      set({ benchmarks: { ...get().benchmarks, ...(event.results as AppState["benchmarks"]) } });
    }
  }
}));
