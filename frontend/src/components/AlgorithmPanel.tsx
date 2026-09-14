import { ALGORITHM_LABELS, adminFetch, type AlgorithmId } from "../types";
import { useStore } from "../state/store";

const OPTIONS: AlgorithmId[] = ["token_bucket", "sliding_window_log", "sliding_window_counter"];

export function AlgorithmPanel() {
  const selected = useStore((s) => s.selectedAlgorithm);
  const current = useStore((s) => s.algorithm);
  const setSelected = useStore((s) => s.setSelectedAlgorithm);

  async function apply() {
    await adminFetch("/config/algorithm", {
      method: "PUT",
      body: JSON.stringify({ algorithm: selected })
    });
  }

  return (
    <aside className="glass panel">
      <h3>Rate limiting strategy</h3>
      <div className="algo-list">
        {OPTIONS.map((id) => (
          <button
            key={id}
            className={`algo-option ${selected === id ? "active" : ""}`}
            onClick={() => setSelected(id)}
            type="button"
          >
            <span>{ALGORITHM_LABELS[id]}</span>
            <span className="radio" />
          </button>
        ))}
      </div>
      <button className="apply" type="button" onClick={() => void apply()} disabled={selected === current}>
        Apply
      </button>
      <div className="current-alg">Current: {ALGORITHM_LABELS[current]}</div>
    </aside>
  );
}
