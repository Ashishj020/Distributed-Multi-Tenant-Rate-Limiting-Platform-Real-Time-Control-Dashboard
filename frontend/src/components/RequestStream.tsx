import { useStore } from "../state/store";

function formatTs(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleTimeString("en-GB", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function RequestStream() {
  const stream = useStore((s) => s.stream);
  return (
    <section className="glass stream">
      <div className="section-title" style={{ margin: "0 0 8px" }}>
        <h2>Live request stream</h2>
        <span className="pill">sampled websocket events</span>
      </div>
      <div className="stream-list">
        {stream.length === 0 && <div className="empty-note">Waiting for traffic…</div>}
        {stream.map((event) => (
          <div className="stream-row" key={event.id}>
            <span>{formatTs(event.timestamp)}</span>
            <span>{event.tenant_id}</span>
            <span className={event.allowed ? "ok" : "bad"}>{event.allowed ? "ALLOWED" : "REJECTED"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
