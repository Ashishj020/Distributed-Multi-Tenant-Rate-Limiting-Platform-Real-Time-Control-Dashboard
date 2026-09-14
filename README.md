# Distributed Multi-Tenant Rate Limiter

A working rate-limiting platform for a multi-tenant API: concurrent clients hit a **decision API**, algorithms run atomically in **Redis**, and a **dark-glass dashboard** streams live decisions over **WebSockets**.

This is not a mocked demo. `/check` consults Redis on every request. Stress tests generate real HTTP traffic. Benchmark numbers come from those runs.

## Overview

Operators can:

- Enforce independent limits per tenant
- Swap **Token Bucket**, **Sliding Window Log**, and **Sliding Window Counter** at runtime
- Watch utilization, rejections, and latency under a 50-tenant load
- Compare measured throughput / percentiles after each run

## Architecture

```text
Clients / Load tester / Dashboard stress test
                 ↓
          GET /check?tenant_id=
                 ↓
          Rate Limiter (Node.js / Fastify)
                 ↓
          Strategy factory (runtime selection)
                 ↓
          Redis Lua (atomic READ → DECIDE → WRITE)
                 ↓
          Decision JSON + rate-limit headers
                 ↓
          Sampled WebSocket events + 100ms stats
                 ↓
          Control dashboard
```

Multiple limiter instances share Redis. Algorithm changes publish on `ratelimit:events` so every process switches strategy without a restart.

State isolation on switch (**Option A**): each algorithm has its own key namespace. Switching does not migrate counters; the new algorithm starts from empty state. Old keys expire via TTL.

## Algorithms

| Algorithm | What it stores | Allows | Cost |
| --- | --- | --- | --- |
| **Token Bucket** | `tokens`, `last_refill_ms` | Burst up to `burst_capacity`, then refill at `limit / window` | O(1) memory and time |
| **Sliding Window Log** | Sorted set of request timestamps | Exact count in the last `window` seconds | O(k) memory for k allowed requests in the window |
| **Sliding Window Counter** | Current + previous window counts | Weighted estimate `current + previous * (1 − elapsed/window)` | O(1) memory, approximate |

**Why they behave differently under the same load**

- Token Bucket admits a burst immediately, then throttles to the refill rate. Short stress tests often show a higher *allowed* count at the start and smoother leftover capacity.
- Sliding Window Log is the strict historian: the Nth request in the window is rejected until the oldest timestamp ages out. It is the most precise and the most Redis-heavy (ZADD + ZREMRANGEBYSCORE + ZCARD + ZRANGE).
- Sliding Window Counter interpolates two counters. It avoids storing every timestamp, so it is cheaper than the log, but it can admit slightly more or fewer requests than a perfect sliding window around a boundary.

## Redis design

### Key schema

```text
ratelimit:config:algorithm                  STRING   current strategy
ratelimit:tenants                           SET      tenant ids
ratelimit:tenant:{tenant_id}                HASH     config
ratelimit:token_bucket:{tenant_id}          HASH     tokens, last_refill_ms
ratelimit:sliding_window_log:{tenant_id}    ZSET     score = timestamp_ms
ratelimit:sliding_window_counter:{tenant_id} HASH    window, count, prev_window, prev_count
ratelimit:benchmarks                        HASH     algorithm → JSON result
ratelimit:events                            PUB/SUB  dashboard + config fan-out
```

### TTL

Inactive tenant state expires at `max(window_seconds * multiplier, 120)`:

- token bucket ×3
- sliding window log ×2
- sliding window counter ×3

### Atomicity

Every decision is a single Lua script (EVAL). Redis runs the script to completion, so there is no `GET → increment in Node → SET` race. Concurrent `/check` calls cannot oversubscribe a tenant beyond the algorithm's semantics.

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/check?tenant_id=` | public | Allow / deny |
| `PUT` | `/config/algorithm` | `x-admin-key` | Live strategy switch |
| `PUT` | `/admin/config/algorithm` | `x-admin-key` | Same, under the admin prefix |
| `GET` | `/admin/tenants` | `x-admin-key` | Tenant configs |
| `PUT` | `/admin/tenants/:id` | `x-admin-key` | Update a tenant |
| `POST` | `/admin/stress-test` | `x-admin-key` | 50-tenant (configurable) HTTP load |
| `GET` | `/admin/benchmarks` | `x-admin-key` | Last measured results |
| `GET` | `/health` | public | Liveness + Redis status |
| `GET` | `/ready` | public | 503 if Redis is down |
| `GET` | `/metrics` | public | Prometheus counters / histograms |
| `GET` | `/ws` | public | WebSocket event stream |

### `/check` response

```json
{
  "allowed": true,
  "remaining": 73,
  "reset_at": 1726324200,
  "limit": 100,
  "algorithm": "token_bucket"
}
```

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. Rejected requests return **429** and `Retry-After`.

Invalid tenant ids → 400. Unknown tenant → 404. Disabled tenant → 403.

### Fail mode

`RATE_LIMIT_FAIL_MODE=closed` (default): if Redis is unavailable, `/check` returns **503** with `allowed: false`.

`RATE_LIMIT_FAIL_MODE=open`: Redis failures **allow** the request and set `X-RateLimit-Degraded: true`. Use this only when availability is more important than enforcement.

## Running locally

```bash
docker compose up --build
```

Then open [http://localhost:8088](http://localhost:8088).

The limiter API is also on [http://localhost:3008](http://localhost:3008). Redis stays on the Compose network (not published to the host). If 8088/3008 are taken on your machine, change the left-hand ports in `docker-compose.yml`.

Copy `.env.example` to `.env` if you want to override `ADMIN_API_KEY` or the startup algorithm. Compose defaults work without a `.env` file (`ADMIN_API_KEY=change-me-in-production`).

### Demo flow

1. Open the dashboard — 50 tenants are seeded (`tenant_01` … `tenant_50`).
2. Confirm **Token Bucket** is selected.
3. Click **Start Stress Test** (50 tenants, 30s, configurable rate).
4. Watch rings fill, sparklines accelerate, the request stream, and 429s.
5. Switch to **Sliding Window Log** → Apply. Redis namespace changes; a toast confirms it.
6. Run the same stress test again.
7. Switch to **Sliding Window Counter** and repeat.
8. Compare measured throughput, P50 / P95 / P99, and rejection rate in the table.

Traffic is not uniform: ~70% of tenants are normal, ~20% heavy, ~10% burst-heavy, plus a few low-rate tenants. The generator weights those profiles so algorithms actually diverge.

## Load testing

From the repo root (limiter must be running):

```bash
npm run load-test -- --tenants 50 --duration 30 --rate 4000
```

Or:

```bash
cd load-test
npm install
node autocannon.js --tenants 50 --duration 30 --rate 4000 --url http://127.0.0.1:3008
```

See [load-test/README.md](load-test/README.md).

Equivalent-condition comparison of all three algorithms:

```bash
DURATION=20 RATE=3000 TENANTS=50 npm run benchmark
```

`make benchmark` runs the same script.

## Tests

```bash
docker compose up -d redis
docker compose --profile test run --rm --build tests
```

Coverage includes token refill / burst capacity, exact sliding-log windows, counter window transitions, and concurrent clients against Redis (allowed + rejected == total, with Lua-enforced caps).

## Benchmark results

Numbers below were **measured** on this project’s Docker stack (single rate-limiter container + Redis 7, Windows host) with:

```text
duration = 12s
target   = 2500 req/s
tenants  = 50
```

Re-run `npm run benchmark` on your machine; results also land in the dashboard and Redis. The dashboard table stays empty until a real test completes.

| Algorithm              |  Req/sec |      Avg |      P50 |      P95 |      P99 | Rejection Rate | CPU | RSS |
| ---------------------- | -------: | -------: | -------: | -------: | -------: | -------------: | --: | --: |
| Token Bucket           |   1919.4 | 16.08 ms | 13.23 ms | 34.96 ms | 58.86 ms |          70.4% | 119% | 111 MB |
| Sliding Window Log     |   1958.8 | 15.80 ms | 14.03 ms | 30.09 ms | 44.87 ms |          55.7% | 107% | 113 MB |
| Sliding Window Counter |   2125.1 | 14.57 ms | 12.63 ms | 29.46 ms | 44.45 ms |          58.9% | 105% | 113 MB |

Under this mix, Token Bucket spends its burst then rejects at the refill rate, so a short test shows the highest rejection ratio. Sliding Window Log is exact and more Redis-heavy, but here it admitted more traffic because expired timestamps free slots inside the 60s window. Sliding Window Counter was the highest throughput / lowest P99 in this run — O(1) state and a weighted estimate rather than a full timestamp log.

CPU % is process time relative to wall clock (can exceed 100% with multiple cores). Errors were 0 for all three runs.

## Observability

Prometheus metrics on `/metrics`:

- `rate_limit_checks_total`
- `rate_limit_allowed_total`
- `rate_limit_rejected_total`
- `rate_limit_check_duration_seconds`
- `redis_operation_duration_seconds`
- `active_tenants`
- `rate_limiter_redis_up`

The dashboard additionally samples decision events (`WS_DECISION_SAMPLE_RATE`) so the UI stays smooth at multi-thousand req/s. Aggregated tenant stats flush every `METRICS_FLUSH_MS` (default 100ms). The live stream is capped (~80 rows) so the DOM does not grow without bound.

## Configuration

See `.env.example`. Nothing Redis- or environment-specific is hardcoded in the algorithms. Tenant limits live in Redis hashes and an in-memory registry loaded at boot.

Default tenants include the spec examples:

- `tenant_01` → 100 req / 60s
- `tenant_02` → 500 req / 60s
- `tenant_03` → 1000 req / 60s
- `tenant_04` → 50 req / 60s

## Design decisions

- **Fastify instead of Express** — the hot path is a single Lua round trip; Fastify's lower overhead matters at several thousand req/s.
- **Lua, not MULTI/GET/SET** — correctness under concurrency is a product requirement, not an optimization.
- **Namespace isolation on algorithm switch** — converting token counts into a timestamp log is lossy; clean namespaces make A/B comparison honest.
- **In-process stress tester + autocannon** — the dashboard needs profiled, tenant-aware traffic; autocannon is the reproducible external client.
- **Fail-closed by default** — a rate limiter that fails open during a Redis outage is a silent quota breach.

## Limitations / future work

- Single Redis primary (no cluster / CRDT multi-region merge)
- No per-endpoint or hierarchical quotas
- Dashboard stats are local to the instance that handled the requests (pub/sub carries algorithm changes and sampled events)
- Adaptive limits and fairness across tenants are out of scope
- Sliding Window Log memory grows with admitted requests per window; very large limits should prefer the counter or bucket

## Project layout

```text
backend/          Fastify service, Lua strategies, stress tester, tests
frontend/         Vite + React dark-glass control plane
load-test/        autocannon + multi-algorithm benchmark
redis/            redis.conf (TTL + noeviction)
docker-compose.yml
```
