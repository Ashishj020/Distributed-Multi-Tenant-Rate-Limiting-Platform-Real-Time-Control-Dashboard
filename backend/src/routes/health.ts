import type { FastifyInstance } from "fastify";
import type { AppContext } from "../types.js";

export async function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/health", async () => ({
    status: ctx.redisReady ? "ok" : "degraded",
    algorithm: ctx.factory.currentId(),
    redis: ctx.redisReady ? "up" : "down",
    fail_mode: ctx.env.RATE_LIMIT_FAIL_MODE
  }));

  app.get("/ready", async (_request, reply) => {
    if (!ctx.redisReady) {
      return reply.code(503).send({ ready: false, redis: "down" });
    }
    return { ready: true, redis: "up" };
  });

  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", ctx.metrics.registry.contentType);
    return ctx.metrics.registry.metrics();
  });
}
