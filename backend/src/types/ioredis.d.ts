declare module "ioredis" {
  interface RedisOptions {
    password?: string;
    maxRetriesPerRequest?: number | null;
    enableReadyCheck?: boolean;
    lazyConnect?: boolean;
    connectionName?: string;
    retryStrategy?: (times: number) => number | void | null;
  }

  class Redis {
    constructor(url?: string, options?: RedisOptions);
    defineCommand(name: string, definition: { numberOfKeys: number; lua: string }): void;
    connect(): Promise<void>;
    disconnect(): void;
    ping(): Promise<string>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<string>;
    hset(key: string, field: string, value: string): Promise<number>;
    hset(key: string, object: Record<string, string>): Promise<number>;
    hgetall(key: string): Promise<Record<string, string>>;
    sadd(key: string, ...members: string[]): Promise<number>;
    smembers(key: string): Promise<string[]>;
    publish(channel: string, message: string): Promise<number>;
    subscribe(...channels: string[]): Promise<unknown>;
    pipeline(): {
      hgetall(key: string): unknown;
      hset(key: string, object: Record<string, string>): unknown;
      sadd(key: string, member: string): unknown;
      exec(): Promise<Array<[Error | null, unknown]> | null>;
    };
    keys(pattern: string): Promise<string[]>;
    del(...keys: string[]): Promise<number>;
    on(event: string, listener: (...args: never[]) => void): this;
    tokenBucketCheck(
      key: string,
      capacity: number,
      refillPerSec: number,
      nowMs: number,
      ttl: number,
      cost: number
    ): Promise<[number | string, number | string, number | string, string]>;
    slidingLogCheck(
      key: string,
      nowMs: number,
      windowMs: number,
      limit: number,
      ttl: number,
      requestId: string
    ): Promise<[number | string, number | string, number | string, number | string]>;
    slidingCounterCheck(
      key: string,
      nowMs: number,
      windowMs: number,
      limit: number,
      ttl: number
    ): Promise<[number | string, number | string, number | string, string]>;
  }

  export default Redis;
  export { Redis };
}
