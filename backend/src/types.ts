import type { AlgorithmId, AppEnv } from "./config/env.js";
import type { StrategyFactory } from "./algorithms/factory.js";
import type { TenantRegistry } from "./config/tenantRegistry.js";
import type { RedisBundle } from "./redis/client.js";
import type { Metrics } from "./metrics/registry.js";
import type { LiveAggregator } from "./websocket/aggregator.js";
import type { EventHub } from "./websocket/hub.js";
import type { StressTestResult } from "./loadgen/stressTest.js";

export interface AppContext {
  env: AppEnv;
  redis: RedisBundle;
  redisReady: boolean;
  factory: StrategyFactory;
  tenants: TenantRegistry;
  metrics: Metrics;
  aggregator: LiveAggregator;
  hub: EventHub;
  stressRunning: boolean;
  benchmarks: Partial<Record<AlgorithmId, StressTestResult>>;
}
