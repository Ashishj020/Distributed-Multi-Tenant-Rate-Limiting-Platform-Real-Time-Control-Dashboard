import { memo } from "react";

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ringClass(utilization: number): string {
  if (utilization >= 1) return "limited";
  if (utilization >= 0.85) return "critical";
  if (utilization >= 0.6) return "warn";
  return "ok";
}

export const UtilizationRing = memo(function UtilizationRing({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(value, 1));
  const offset = CIRCUMFERENCE * (1 - clamped);
  const pct = Math.round(Math.min(value, 1.5) * 100);
  return (
    <svg className={`ring ${ringClass(value)}`} viewBox="0 0 100 100" aria-label={`${pct}% utilization`}>
      <circle className="ring-bg" cx="50" cy="50" r={RADIUS} />
      <circle
        className="ring-fg"
        cx="50"
        cy="50"
        r={RADIUS}
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        transform="rotate(-90 50 50)"
      />
      <text className="ring-label" x="50" y="55">
        {pct}%
      </text>
    </svg>
  );
});
