import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ALGORITHMS, isAlgorithmId } from "../config/env.js";
import { REDIS_KEYS } from "../config/keys.js";
import { isValidTenantId } from "../config/tenants.js";
import { runStressTest, type StressTestResult } from "../loadgen/stressTest.js";
import type { AppContext } from "../types.js";

const AlgorithmBody = z.object({
  algorithm: z.enum(ALGORITHMS)
});

const TenantPatch = z.object({
  requests_per_window: z.number().int().positive().optional(),
  window_size: z.number().int().positive().optional(),
  burst_capacity: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  traffic_profile: z.enum(["low", "normal", "heavy", "burst"]).optional()
});

const StressBody = z.object({
  duration: z.number().int().min(3).max(120).default(30),
  rate: z.number().int().min(50).max(20_000).default(4000),
  tenants: z.number().int().min(1).max(50).default(50)
});

function requireAdmin(ctx: AppContext, request: FastifyRequest, reply: FastifyReply): boolean {
  const header = String(request.headers["x-admin-key"] ?? "");
  const query = String((request.query as { admin_key?: string }).admin_key ?? "");
  const key = header || query;
  if (key !== ctx.env.ADMIN_API_KEY) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

export async function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/admin/config", async (request, reply) => {
    if (!requireAdmin(ctx, request, reply)) return;
    return {
      algorithm: ctx.factory.currentId(),
      fail_mode: ctx.env.RATE_LIMIT_FAIL_MODE,
      redis: ctx.redisReady ? "up" : "down",
      tenants: ctx.tenants.size()
    };
  });

  app.put("/config/algorithm", async (request, reply) => {
    if (!requireAdmin(ctx, request, reply)) return;
    return switchAlgorithm(ctx, request, reply);
  });

  app.put("/admin/config/algorithm", async (request, reply) => {
    if (!requireAdmin(ctx, request, reply)) return;
    return switchAlgorithm(ctx, request, reply);
  });

  app.get("/admin/tenants", async (request, reply) => {
    if (!requireAdmin(ctx, request, reply)) return;
    return { tenants: ctx.tenants.list() };
  });

  app.put("/admin/tenants/:tenantId", async (request, reply) => {
    if (!requireAdmin(ctx, request, reply)) return;
    const tenantId = String((request.params as { tenantId: string }).tenantId);
    if (!isValidTenantId(tenantId)) {
      return reply.code(400).send({ error: "malformed tenant_id" });
    }
    const parsed = TenantPatch.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid tenant payload", details: parsed.error.flatten() });
    }
    const tenant = await ctx.tenants.upsert({ tenant_id: tenantId, ...parsed.data });
    ctx.aggregator.seedTenants([tenant]);
    const event = {
      type: "tenant_updated" as const,
      timestamp: Date.now(),
      tenant
    };
    await ctx.hub.broadcast(event);
    return tenant;
  });

  app.get("/admin/stats", async (request, reply) => {
    if (!requireAdmin(ctx, request, reply)) return;
    return ctx.aggregator.snapshot();
  });

  app.get("/admin/benchmarks", async (request, reply) => {
    if (!requireAdmin(ctx, request, reply)) return;
    return { results: ctx.benchmarks };
  });

  app.post("/admin/stress-test", async (request, reply) => {
    if (!requireAdmin(ctx, request, reply)) return;
    if (ctx.stressRunning) {
      return reply.code(409).send({ error: "stress test already running" });
    }
    const parsed = StressBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid stress test payload" });
    }

    ctx.stressRunning = true;
    const config = parsed.data;
    await ctx.hub.broadcast({
      type: "stress_test_started",
      timestamp: Date.now(),
      duration: config.duration,
      rate: config.rate,
      tenants: config.tenants,
      algorithm: ctx.factory.currentId()
    });

    const port = ctx.env.PORT;
    const baseUrl = `http://127.0.0.1:${port}`;

    setImmediate(() => {
      void (async () => {
        try {
          const result = await runStressTest(
            {
              baseUrl,
              tenants: ctx.tenants.list(),
              durationSec: config.duration,
              targetRps: config.rate,
              tenantCount: config.tenants,
              algorithm: ctx.factory.currentId()
            },
            (progress) => {
              ctx.hub.local({
                type: "stress_test_progress",
                timestamp: Date.now(),
                ...progress
              });
            }
          );
          ctx.benchmarks[result.algorithm] = result;
          await ctx.redis.client.hset(
            REDIS_KEYS.benchmarks,
            result.algorithm,
            JSON.stringify(result)
          );
          await ctx.hub.broadcast({
            type: "stress_test_completed",
            timestamp: Date.now(),
            result
          });
          await ctx.hub.broadcast({
            type: "benchmark_updated",
            timestamp: Date.now(),
            results: ctx.benchmarks
          });
        } catch (error) {
          request.log.error(error, "stress test failed");
          await ctx.hub.broadcast({
            type: "stress_test_completed",
            timestamp: Date.now(),
            error: error instanceof Error ? error.message : "stress_test_failed"
          });
        } finally {
          ctx.stressRunning = false;
        }
      })();
    });

    return reply.code(202).send({
      status: "started",
      duration: config.duration,
      rate: config.rate,
      tenants: config.tenants,
      algorithm: ctx.factory.currentId()
    });
  });
}

async function switchAlgorithm(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const parsed = AlgorithmBody.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid algorithm",
      supported: ALGORITHMS
    });
  }
  const algorithm = parsed.data.algorithm;
  if (!isAlgorithmId(algorithm)) {
    return reply.code(400).send({ error: "unknown algorithm" });
  }

  const previous = ctx.factory.currentId();
  await ctx.factory.persist(ctx.redis.client, algorithm);
  ctx.aggregator.setAlgorithm(algorithm);
  const changed_at = new Date().toISOString();
  await ctx.hub.broadcast({
    type: "algorithm_changed",
    timestamp: Date.now(),
    algorithm,
    previous,
    changed_at
  });
  return { algorithm, previous, changed_at };
}
