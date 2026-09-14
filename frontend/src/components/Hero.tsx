import { ALGORITHM_LABELS } from "../types";
import { useStore } from "../state/store";
import { AlgorithmPanel } from "./AlgorithmPanel";

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

export function Hero() {
  const algorithm = useStore((s) => s.algorithm);
  const rps = useStore((s) => s.rps);
  const allowed = useStore((s) => s.allowed);
  const rejected = useStore((s) => s.rejected);
  const utilization = useStore((s) => s.utilization);
  const connected = useStore((s) => s.connected);
  const stress = useStore((s) => s.stress);
  const utilPct = Math.round(utilization * 100);
  const utilClass = utilization >= 0.85 ? "danger" : utilization >= 0.6 ? "warn" : "";
  const health = !connected ? "danger" : stress.running || utilization >= 0.85 ? "warn" : "";

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <span className="kicker">Control plane</span>
          <h1>Distributed Rate Limiter</h1>
        </div>
        <div className="pills">
          <span className="pill">
            <span className={`dot ${health}`} />
            {connected ? (stress.running ? "Stress test running" : "Healthy") : "Disconnected"}
          </span>
          <span className="pill">Redis shared state</span>
          <span className="pill">{ALGORITHM_LABELS[algorithm]}</span>
        </div>
      </div>

      <section className="hero">
        <div className="glass hero-main">
          <h2>Current algorithm</h2>
          <p className="algorithm-name">{ALGORITHM_LABELS[algorithm]}</p>
          <div className="metrics">
            <div className="metric">
              <div className="label">Requests/sec</div>
              <div className="value">{fmt(rps)}</div>
            </div>
            <div className="metric">
              <div className="label">Allowed</div>
              <div className="value">{fmt(allowed)}</div>
            </div>
            <div className="metric">
              <div className="label">Rejected</div>
              <div className="value danger">{fmt(rejected)}</div>
            </div>
            <div className="metric">
              <div className="label">Global utilization</div>
              <div className="value">{utilPct}%</div>
            </div>
          </div>
          <div className="util-track" aria-label="global utilization">
            <div className={`util-fill ${utilClass}`} style={{ width: `${Math.min(utilPct, 100)}%` }} />
          </div>
        </div>
        <AlgorithmPanel />
      </section>
    </>
  );
}
