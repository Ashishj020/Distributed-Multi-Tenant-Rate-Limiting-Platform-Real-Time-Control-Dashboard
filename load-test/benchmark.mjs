#!/usr/bin/env node
/**
 * Benchmarks all three algorithms under equivalent conditions via the
 * in-process stress tester (real HTTP -> rate limiter -> Redis).
 */
const url = process.env.RATE_LIMITER_URL || "http://127.0.0.1:3008";
const adminKey = process.env.ADMIN_API_KEY || "change-me-in-production";
const duration = Number(process.env.DURATION || 20);
const rate = Number(process.env.RATE || 3000);
const tenants = Number(process.env.TENANTS || 50);

const ALGORITHMS = ["token_bucket", "sliding_window_log", "sliding_window_counter"];

async function admin(path, options = {}) {
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": adminKey,
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202) {
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForResult(algorithm, startedAt) {
  const timeout = Date.now() + (duration + 45) * 1000;
  while (Date.now() < timeout) {
    const payload = await admin("/admin/benchmarks");
    const result = payload.results?.[algorithm];
    if (result && new Date(result.completed_at).getTime() >= startedAt - 1000) {
      return result;
    }
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for ${algorithm} benchmark`);
}

function cell(value, digits = 1) {
  return String(value.toFixed(digits)).padStart(10);
}

async function main() {
  console.log(`Benchmarking ${url} duration=${duration}s rate=${rate} tenants=${tenants}\n`);
  const results = [];

  for (const algorithm of ALGORITHMS) {
    console.log(`→ switching to ${algorithm}`);
    await admin("/config/algorithm", {
      method: "PUT",
      body: JSON.stringify({ algorithm })
    });
    await sleep(500);
    const startedAt = Date.now();
    console.log(`→ starting stress test`);
    await admin("/admin/stress-test", {
      method: "POST",
      body: JSON.stringify({ duration, rate, tenants })
    });
    const result = await waitForResult(algorithm, startedAt);
    results.push(result);
    console.log(
      `  ${algorithm}: ${result.throughput} req/s  p99=${result.latency_p99_ms}ms  reject=${(
        result.rejection_rate * 100
      ).toFixed(1)}%`
    );
  }

  console.log("\n| Algorithm              |  Req/sec |      P50 |      P95 |      P99 | Rejection Rate |     CPU |    RSS |");
  console.log("| ---------------------- | -------: | -------: | -------: | -------: | -------------: | ------: | -----: |");
  for (const row of results) {
    const name = row.algorithm.replaceAll("_", " ");
    console.log(
      `| ${name.padEnd(22)} | ${cell(row.throughput, 1)} | ${cell(row.latency_p50_ms, 2)} | ${cell(
        row.latency_p95_ms,
        2
      )} | ${cell(row.latency_p99_ms, 2)} | ${cell(row.rejection_rate * 100, 2)}% | ${cell(
        row.cpu_percent,
        1
      )}% | ${cell(row.memory_rss_mb, 1)} |`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
