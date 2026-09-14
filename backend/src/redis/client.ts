import Redis from "ioredis";
import type { AppEnv } from "../config/env.js";
import { registerLuaCommands } from "./scripts.js";

export interface RedisBundle {
  client: Redis;
  subscriber: Redis;
  publisher: Redis;
}

function createClient(env: AppEnv, name: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
    connectionName: name,
    retryStrategy(times: number) {
      return Math.min(times * 200, 2000);
    }
  });
  client.on("error", (err: Error) => {
    console.error(`[redis:${name}]`, err.message);
  });
  return client;
}

export async function connectRedis(env: AppEnv): Promise<RedisBundle> {
  const client = createClient(env, "rate-limiter");
  const subscriber = createClient(env, "rate-limiter-sub");
  const publisher = createClient(env, "rate-limiter-pub");

  registerLuaCommands(client);

  await Promise.all([client.connect(), subscriber.connect(), publisher.connect()]);
  await client.ping();
  return { client, subscriber, publisher };
}

export async function closeRedis(bundle: RedisBundle): Promise<void> {
  bundle.subscriber.disconnect();
  bundle.publisher.disconnect();
  bundle.client.disconnect();
}
