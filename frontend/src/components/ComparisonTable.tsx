import { ALGORITHM_LABELS, type AlgorithmId } from "../types";
import { useStore } from "../state/store";

const ROWS: AlgorithmId[] = ["token_bucket", "sliding_window_log", "sliding_window_counter"];

export function ComparisonTable() {
  const benchmarks = useStore((s) => s.benchmarks);
  const algorithm = useStore((s) => s.algorithm);
  const hasAny = ROWS.some((id) => benchmarks[id]);

  return (
    <section className="glass panel">
      <h3>Live algorithm comparison</h3>
      {!hasAny && (
        <p className="empty-note">
          Run a stress test for each algorithm to populate measured throughput and latency. Numbers are never
          hardcoded.
        </p>
      )}
      {hasAny && (
        <table>
          <thead>
            <tr>
              <th>Algorithm</th>
              <th className="num">Throughput</th>
              <th className="num">P50</th>
              <th className="num">P95</th>
              <th className="num">P99</th>
              <th className="num">Reject</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((id) => {
              const row = benchmarks[id];
              return (
                <tr key={id} className={id === algorithm ? "row-active" : ""}>
                  <td>{ALGORITHM_LABELS[id]}</td>
                  <td className="num">{row ? `${row.throughput.toLocaleString()}/s` : "—"}</td>
                  <td className="num">{row ? `${row.latency_p50_ms.toFixed(2)}ms` : "—"}</td>
                  <td className="num">{row ? `${row.latency_p95_ms.toFixed(2)}ms` : "—"}</td>
                  <td className="num">{row ? `${row.latency_p99_ms.toFixed(2)}ms` : "—"}</td>
                  <td className="num">{row ? `${(row.rejection_rate * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
