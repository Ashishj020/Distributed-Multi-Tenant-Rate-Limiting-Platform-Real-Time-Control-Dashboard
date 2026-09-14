import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { StrategyFactory } from "./algorithms/factory.js";
import { loadEnv } from "./config/env.js";
import { REDIS_KEYS } from "./config/keys.js";
import { TenantRegistry } from "./config/tenantRegistry.js";
import { closeRedis, connectRedis } from "./redis/client.js";
import { createMetrics } from "./metrics/registry.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerCheckRoute } from "./routes/check.js";
import { registerHealthRoutes } from "./routes/health.js";
import type { AppContext } from "./types.js";
import { LiveAggregator } from "./websocket/aggregator.js";
import { EventHub } from "./websocket/hub.js";
import type { AlgorithmId } from "./config/env.js";
import type { StressTestResult } from "./loadgen/stressTest.js";
import { isAlgorithmId } from "./config/env.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const metrics = createMetrics();
  const redis = await connectRedis(env);
  const factory = new StrategyFactory(redis.client, env.RATE_LIMIT_ALGORITHM);
  const algorithm = await factory.restore(redis.client, env.RATE_LIMIT_ALGORITHM);
  const tenants = new TenantRegistry(redis.client);
  await tenants.load();
  metrics.activeTenants.set(tenants.size());
  metrics.redisUp.set(1);

  const storedBenchmarks = await redis.client.hgetall(REDIS_KEYS.benchmarks);
  const benchmarks: Partial<Record<AlgorithmId, StressTestResult>> = {};
  for (const [key, value] of Object.entries(storedBenchmarks)) {
    if (!isAlgorithmId(key)) continue;
    try {
      benchmarks[key] = JSON.parse(value) as StressTestResult;
    } catch {
      // skip corrupt entries
    }
  }

  const instanceId = randomUUID();
  const aggregator = new LiveAggregator(algorithm, env.WS_DECISION_SAMPLE_RATE, tenants.list());
  const hub = new EventHub(redis.publisher, instanceId);
  hub.onSnapshot(() => ({
    type: "snapshot",
    timestamp: Date.now(),
    ...aggregator.snapshot(),
    tenants_config: tenants.list(),
    benchmarks,
    fail_mode: env.RATE_LIMIT_FAIL_MODE,
    redis: "up"
  }));

  const ctx: AppContext = {
    env,
    redis,
    redisReady: true,
    factory,
    tenants,
    metrics,
    aggregator,
    hub,
    stressRunning: false,
    benchmarks
  };

  redis.client.on("ready", () => {
    ctx.redisReady = true;
    metrics.redisUp.set(1);
  });
  redis.client.on("end", () => {
    ctx.redisReady = false;
    metrics.redisUp.set(0);
  });
  redis.client.on("close", () => {
    ctx.redisReady = false;
    metrics.redisUp.set(0);
  });

  await redis.subscriber.subscribe(REDIS_KEYS.pubsub);
  redis.subscriber.on("message", (_channel, message) => {
    const event = hub.ingestRemote(message);
    if (!event) return;
    if (event.type === "algorithm_changed" && typeof event.algorithm === "string" && isAlgorithmId(event.algorithm)) {
      factory.set(event.algorithm);
      aggregator.setAlgorithm(event.algorithm);
    }
    if (event.type === "benchmark_updated" && event.results) {
      Object.assign(ctx.benchmarks, event.results);
    }
  });

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "warn"
    },
    disableRequestLogging: true,
    trustProxy: true
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);
  hub.attach(app);

  await registerCheckRoute(app, ctx);
  await registerAdminRoutes(app, ctx);
  await registerHealthRoutes(app, ctx);

  app.get("/", async () => ({
    service: "distributed-rate-limiter",
    algorithm: factory.currentId(),
    docs: "See README.md"
  }));

  const statsTimer = setInterval(() => {
    const snap = aggregator.snapshot();
    hub.local({
      type: "stats",
      timestamp: Date.now(),
      algorithm: snap.algorithm,
      allowed: snap.allowed,
      rejected: snap.rejected,
      rps: snap.rps,
      utilization: snap.utilization,
      tenants: snap.tenants
    });
  }, env.METRICS_FLUSH_MS);
  statsTimer.unref();

  const pingTimer = setInterval(() => {
    redis.client
      .ping()
      .then(() => {
        ctx.redisReady = true;
        metrics.redisUp.set(1);
      })
      .catch(() => {
        ctx.redisReady = false;
        metrics.redisUp.set(0);
      });
  }, 3000);
  pingTimer.unref();

  const shutdown = async () => {
    clearInterval(statsTimer);
    clearInterval(pingTimer);
    await app.close();
    await closeRedis(redis);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info(`rate limiter listening on ${env.HOST}:${env.PORT} algorithm=${factory.currentId()}`);
}

main().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
