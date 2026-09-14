# Load testing

This directory drives **real HTTP traffic** against `GET /check`. It does not mock metrics.

## Autocannon (external clients)

```bash
npm install
npm run load-test -- --tenants 50 --duration 30 --rate 4000
```

Flags:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--tenants` | 50 | Distinct `tenant_XX` IDs rotated through the request set |
| `--duration` | 30 | Seconds |
| `--rate` | 4000 | Target requests / second (`overallRate`) |
| `--url` | `http://127.0.0.1:3008` | Rate limiter base URL |

`RATE_LIMITER_URL` can also be set in the environment.

Autocannon round-robins tenant IDs. For profiled traffic (low / normal / heavy / burst) use the dashboard **Start Stress Test** button or `benchmark.mjs`, which hit the same `/check` endpoint with weighted tenant selection.

## Equivalent-condition algorithm benchmark

```bash
npm run benchmark
```

This switches algorithms at runtime and runs the in-service stress tester three times with identical `duration`, `rate`, and `tenant` counts.

```bash
DURATION=20 RATE=3000 TENANTS=50 ADMIN_API_KEY=change-me-in-production node benchmark.mjs
```

Results are stored in Redis (`ratelimit:benchmarks`) and appear on the dashboard comparison table.
