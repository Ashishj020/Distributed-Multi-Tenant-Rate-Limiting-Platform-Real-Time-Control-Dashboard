-- Token bucket: atomic refill + consume.
-- KEYS[1] = hash { tokens, last_refill_ms }
-- ARGV: capacity, refill_per_sec, now_ms, ttl_seconds, cost
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
