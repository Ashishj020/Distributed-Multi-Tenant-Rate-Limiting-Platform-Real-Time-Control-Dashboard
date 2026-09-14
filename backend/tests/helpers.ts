import Redis from "ioredis";
import { afterAll, beforeAll } from "vitest";
import { registerLuaCommands } from "../src/redis/scripts.js";

export function redisUrl(): string {
  return process.env.REDIS_URL || "redis://127.0.0.1:6379";
}

export async function createTestRedis(): Promise<Redis> {
  const client = new Redis(redisUrl(), {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    connectTimeout: 4000
  });
  registerLuaCommands(client);
  await client.connect();
  await client.ping();
  return client;
}

export function uniqueTenant(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

export async function flushTenant(redis: Redis, tenantId: string): Promise<void> {
  const keys = await redis.keys(`ratelimit:*:${tenantId}`);
  if (keys.length > 0) await redis.del(...keys);
}

let shared: Redis | null = null;

export async function sharedRedis(): Promise<Redis> {
  if (!shared) shared = await createTestRedis();
  return shared;
}

beforeAll(async () => {
  try {
    await sharedRedis();
  } catch (error) {
    console.warn("Redis is required for algorithm tests:", error);
    throw error;
  }
});

afterAll(async () => {
  if (shared) {
    shared.disconnect();
    shared = null;
  }
});
