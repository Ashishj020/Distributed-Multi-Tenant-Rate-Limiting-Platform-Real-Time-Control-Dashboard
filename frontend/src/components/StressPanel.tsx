import { useState } from "react";
import { adminFetch } from "../types";
import { useStore } from "../state/store";

export function StressPanel() {
  const stress = useStore((s) => s.stress);
  const lastResult = useStore((s) => s.lastResult);
  const [duration, setDuration] = useState(30);
  const [rate, setRate] = useState(4000);
  const [tenants, setTenants] = useState(50);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    const response = await adminFetch("/admin/stress-test", {
      method: "POST",
      body: JSON.stringify({ duration, rate, tenants })
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error || `Unable to start stress test (${response.status})`);
    }
  }

  return (
    <section className="glass panel">
      <h3>Stress test</h3>
      <div className="stress-controls">
        <div className="field">
          <label>Tenants</label>
          <input
            type="number"
            min={1}
            max={50}
            value={tenants}
            onChange={(e) => setTenants(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>Duration (s)</label>
          <input
            type="number"
            min={3}
            max={120}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>Target rate</label>
          <input type="number" min={50} max={20000} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
        </div>
      </div>
      <button className={`stress-btn ${stress.running ? "running" : ""}`} type="button" onClick={() => void start()} disabled={stress.running}>
        {stress.running ? "STRESS TEST RUNNING" : "START STRESS TEST"}
      </button>
      {error && <p className="empty-note">{error}</p>}
      {stress.running && (
        <div className="stress-result">
          <div>
            <span>Elapsed</span>
            {stress.elapsed_sec.toFixed(1)}s
          </div>
          <div>
            <span>Issued</span>
            {stress.requests.toLocaleString()}
          </div>
          <div>
            <span>Live rps</span>
            {Math.round(stress.rps).toLocaleString()}
          </div>
        </div>
      )}
      {lastResult && !stress.running && (
        <div className="stress-result">
          <div>
            <span>Requests</span>
            {lastResult.requests.toLocaleString()}
          </div>
          <div>
            <span>Allowed</span>
            {lastResult.allowed.toLocaleString()}
          </div>
          <div>
            <span>Rejected</span>
            {lastResult.rejected.toLocaleString()}
          </div>
          <div>
            <span>Duration</span>
            {lastResult.duration_sec.toFixed(1)}s
          </div>
          <div>
            <span>Throughput</span>
            {lastResult.throughput.toLocaleString()}/s
          </div>
          <div>
            <span>P99</span>
            {lastResult.latency_p99_ms.toFixed(2)}ms
          </div>
        </div>
      )}
    </section>
  );
}
