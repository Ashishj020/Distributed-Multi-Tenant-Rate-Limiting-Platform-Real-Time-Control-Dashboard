-- Sliding window counter: weighted current + previous fixed windows.
-- KEYS[1] = hash { window, count, prev_window, prev_count }
-- ARGV: now_ms, window_ms, limit, ttl_seconds
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
