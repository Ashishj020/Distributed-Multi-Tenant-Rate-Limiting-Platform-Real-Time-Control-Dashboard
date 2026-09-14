-- Sliding window log: exact timestamps in a sorted set.
-- KEYS[1] = zset score=timestamp_ms member=unique request id
-- ARGV: now_ms, window_ms, limit, ttl_seconds, request_id
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
