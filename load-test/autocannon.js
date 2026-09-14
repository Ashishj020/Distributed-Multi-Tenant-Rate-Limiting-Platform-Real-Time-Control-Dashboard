#!/usr/bin/env node
/**
 * Multi-tenant load test against GET /check.
 *
 * Example:
 *   node autocannon.js --tenants 50 --duration 30 --rate 4000
 */
import autocannon from "autocannon";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const tenants = Number(arg("tenants", 50));
const duration = Number(arg("duration", 30));
const rate = Number(arg("rate", 4000));
const url = arg("url", process.env.RATE_LIMITER_URL || "http://127.0.0.1:3008");

const requests = Array.from({ length: tenants }, (_, i) => ({
  method: "GET",
  path: `/check?tenant_id=tenant_${String(i + 1).padStart(2, "0")}`
}));

const instance = autocannon(
  {
    url,
    connections: Math.min(100, Math.max(10, tenants)),
    duration,
    overallRate: rate,
    requests,
    title: `rate-limiter tenants=${tenants} rate=${rate}`
  },
  (error, result) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }
    console.log("\nLoad test complete");
    console.log(`Requests: ${result.requests.total}`);
    console.log(`Throughput: ${result.requests.mean.toFixed(1)} req/s`);
    console.log(`Latency p50: ${result.latency.p50} ms`);
    console.log(`Latency p95: ${result.latency.p97_5} ms`);
    console.log(`Latency p99: ${result.latency.p99} ms`);
    console.log(`Non-2xx (includes 429s): ${result.non2xx}`);
    const rejectionRate = result.requests.total === 0 ? 0 : result.non2xx / result.requests.total;
    console.log(`Non-2xx rate: ${(rejectionRate * 100).toFixed(2)}%`);
  }
);

autocannon.track(instance, { renderProgressBar: true });
