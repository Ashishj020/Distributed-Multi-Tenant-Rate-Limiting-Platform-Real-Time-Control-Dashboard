import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../types.js";
import { isValidTenantId, toRateLimitConfig } from "../config/tenants.js";

function setRateHeaders(
  reply: FastifyReply,
  result: { limit: number; remaining: number; reset_at: number; allowed: boolean }
): void {
  reply.header("X-RateLimit-Limit", String(result.limit));
  reply.header("X-RateLimit-Remaining", String(result.remaining));
  reply.header("X-RateLimit-Reset", String(result.reset_at));
  if (!result.allowed) {
    const retry = Math.max(0, result.reset_at - Math.floor(Date.now() / 1000));
    reply.header("Retry-After", String(retry));
  }
}

export async function registerCheckRoute(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/check", async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = String((request.query as { tenant_id?: string }).tenant_id ?? "").trim();
    if (!tenantId) {
      return reply.code(400).send({ error: "tenant_id is required" });
    }
    if (!isValidTenantId(tenantId)) {
      return reply.code(400).send({ error: "malformed tenant_id" });
    }

    const tenant = ctx.tenants.get(tenantId);
    if (!tenant) {
      return reply.code(404).send({ error: "unknown tenant" });
    }
    if (!tenant.enabled) {
      return reply.code(403).send({ error: "tenant disabled", tenant_id: tenantId });
    }

    const algorithm = ctx.factory.currentId();
    const stopTimer = ctx.metrics.checkDuration.startTimer({ algorithm });
    const redisTimer = ctx.metrics.redisDuration.startTimer({ op: "check" });

    try {
      const result = await ctx.factory.get().check(tenantId, toRateLimitConfig(tenant));
      redisTimer();
      stopTimer();

      ctx.metrics.checksTotal.inc({ algorithm, tenant_id: tenantId });
      if (result.allowed) ctx.metrics.allowedTotal.inc({ algorithm });
      else ctx.metrics.rejectedTotal.inc({ algorithm });

      const sampled = ctx.aggregator.record({
        tenant_id: tenantId,
        allowed: result.allowed,
        remaining: result.remaining,
        limit: result.limit,
        algorithm,
        timestamp: Date.now()
      });
      ctx.hub.enqueueDecision(sampled);

      setRateHeaders(reply, result);
      const body = {
        allowed: result.allowed,
        remaining: result.remaining,
        reset_at: result.reset_at,
        limit: result.limit,
        algorithm: result.algorithm
      };
      return reply.code(result.allowed ? 200 : 429).send(body);
    } catch (error) {
      redisTimer();
      stopTimer();
      ctx.metrics.redisUp.set(0);
      const message = error instanceof Error ? error.message : "redis_unavailable";
      request.log.warn({ err: message }, "rate limit check failed");

      if (ctx.env.RATE_LIMIT_FAIL_MODE === "open") {
        reply.header("X-RateLimit-Degraded", "true");
        return reply.code(200).send({
          allowed: true,
          remaining: tenant.requests_per_window,
          reset_at: Math.floor(Date.now() / 1000) + tenant.window_size,
          limit: tenant.requests_per_window,
          algorithm,
          degraded: true
        });
      }

      reply.header("X-RateLimit-Degraded", "true");
      return reply.code(503).send({
        allowed: false,
        remaining: 0,
        reset_at: Math.floor(Date.now() / 1000),
        limit: tenant.requests_per_window,
        algorithm,
        error: "redis_unavailable"
      });
    }
  });
}
