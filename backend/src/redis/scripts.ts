import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Redis from "ioredis";
import type { AlgorithmId } from "../config/env.js";
import { REDIS_KEYS, stateTtlSeconds } from "../config/keys.js";

const TOKEN_BUCKET_LUA = `-- Token bucket: atomic refill + consume.
local capacity = tonumber(ARGV[1])
local refill_per_sec = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local cost = tonumber(ARGV[5])

if capacity <= 0 or refill_per_sec < 0 or cost <= 0 then
  return redis.error_reply("invalid token bucket arguments")
end

local data = redis.call("HMGET", KEYS[1], "tokens", "last_refill_ms")
local tokens = tonumber(data[1])
local last_refill_ms = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  last_refill_ms = now_ms
end

local elapsed_ms = now_ms - last_refill_ms
if elapsed_ms < 0 then
  elapsed_ms = 0
end

if elapsed_ms > 0 and refill_per_sec > 0 then
  tokens = math.min(capacity, tokens + (elapsed_ms * refill_per_sec / 1000.0))
  last_refill_ms = now_ms
end

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call("HSET", KEYS[1], "tokens", tokens, "last_refill_ms", last_refill_ms)
redis.call("EXPIRE", KEYS[1], ttl)

local remaining = math.floor(tokens)
if remaining < 0 then
  remaining = 0
end

local reset_at_ms = now_ms
if refill_per_sec > 0 then
  if allowed == 0 then
    local needed = cost - tokens
    if needed < 0 then
      needed = 0
    end
    reset_at_ms = now_ms + math.ceil((needed / refill_per_sec) * 1000.0)
  else
    local missing = capacity - tokens
    if missing > 0 then
      reset_at_ms = now_ms + math.ceil((missing / refill_per_sec) * 1000.0)
    end
  end
end

local reset_at = math.floor(reset_at_ms / 1000)
return { allowed, remaining, reset_at, tostring(tokens) }
`;

const SLIDING_LOG_LUA = `-- Sliding window log: exact timestamps in a sorted set.
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local request_id = ARGV[5]

if window_ms <= 0 or limit < 0 then
  return redis.error_reply("invalid sliding window log arguments")
end

local window_start = now_ms - window_ms
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", window_start)

local count = redis.call("ZCARD", KEYS[1])
local allowed = 0

if count < limit then
  redis.call("ZADD", KEYS[1], now_ms, request_id)
  count = count + 1
  allowed = 1
end

redis.call("EXPIRE", KEYS[1], ttl)

local remaining = limit - count
if remaining < 0 then
  remaining = 0
end

local reset_at_ms = now_ms + window_ms
local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
if oldest[2] ~= nil then
  reset_at_ms = tonumber(oldest[2]) + window_ms
end

local reset_at = math.floor(reset_at_ms / 1000)
return { allowed, remaining, reset_at, count }
`;

const SLIDING_COUNTER_LUA = `-- Sliding window counter: weighted current + previous fixed windows.
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

if window_ms <= 0 or limit < 0 then
  return redis.error_reply("invalid sliding window counter arguments")
end

local current_window = math.floor(now_ms / window_ms)
local previous_window = current_window - 1
local window_start_ms = current_window * window_ms
local elapsed_ms = now_ms - window_start_ms
local weight = 1.0 - (elapsed_ms / window_ms)
if weight < 0 then
  weight = 0
elseif weight > 1 then
  weight = 1
end

local data = redis.call("HMGET", KEYS[1], "window", "count", "prev_window", "prev_count")
local stored_window = tonumber(data[1])
local stored_count = tonumber(data[2]) or 0
local stored_prev_window = tonumber(data[3])
local stored_prev_count = tonumber(data[4]) or 0

if stored_window == nil then
  stored_window = current_window
  stored_count = 0
  stored_prev_window = previous_window
  stored_prev_count = 0
elseif stored_window == current_window then
  if stored_prev_window ~= previous_window then
    stored_prev_window = previous_window
    stored_prev_count = 0
  end
elseif stored_window == previous_window then
  stored_prev_count = stored_count
  stored_prev_window = stored_window
  stored_count = 0
  stored_window = current_window
else
  stored_prev_count = 0
  stored_prev_window = previous_window
  stored_count = 0
  stored_window = current_window
end

local weighted = stored_count + (stored_prev_count * weight)
local allowed = 0

if weighted < limit then
  stored_count = stored_count + 1
  weighted = stored_count + (stored_prev_count * weight)
  allowed = 1
end

redis.call(
  "HSET",
  KEYS[1],
  "window", stored_window,
  "count", stored_count,
  "prev_window", stored_prev_window,
  "prev_count", stored_prev_count
)
redis.call("EXPIRE", KEYS[1], ttl)

local remaining = math.floor(limit - weighted)
if remaining < 0 then
  remaining = 0
end

local reset_at = math.floor((window_start_ms + window_ms) / 1000)
return { allowed, remaining, reset_at, tostring(weighted) }
`;

function tryRead(name: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "lua", name),
    join(here, "..", "redis", "lua", name),
    join(process.cwd(), "src", "redis", "lua", name)
  ];
  for (const file of candidates) {
    try {
      return readFileSync(file, "utf8");
    } catch {
      // continue
    }
  }
  return null;
}

export const LUA_TOKEN_BUCKET = tryRead("tokenBucket.lua") ?? TOKEN_BUCKET_LUA;
export const LUA_SLIDING_LOG = tryRead("slidingWindowLog.lua") ?? SLIDING_LOG_LUA;
export const LUA_SLIDING_COUNTER = tryRead("slidingWindowCounter.lua") ?? SLIDING_COUNTER_LUA;

export function registerLuaCommands(redis: Redis): void {
  redis.defineCommand("tokenBucketCheck", {
    numberOfKeys: 1,
    lua: LUA_TOKEN_BUCKET
  });
  redis.defineCommand("slidingLogCheck", {
    numberOfKeys: 1,
    lua: LUA_SLIDING_LOG
  });
  redis.defineCommand("slidingCounterCheck", {
    numberOfKeys: 1,
    lua: LUA_SLIDING_COUNTER
  });
}

export function stateKey(algorithm: AlgorithmId, tenantId: string): string {
  return REDIS_KEYS.state(algorithm, tenantId);
}

export { stateTtlSeconds };
