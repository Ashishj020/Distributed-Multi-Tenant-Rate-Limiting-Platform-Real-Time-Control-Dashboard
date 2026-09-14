import { memo, useMemo } from "react";

export const Sparkline = memo(function Sparkline({
  points,
  color = "#7dd3fc"
}: {
  points: number[];
  color?: string;
}) {
  const d = useMemo(() => {
    const w = 140;
    const h = 28;
    const max = Math.max(...points, 1);
    return points
      .map((point, index) => {
        const x = points.length === 1 ? 0 : (index / (points.length - 1)) * w;
        const y = h - (point / max) * (h - 4) - 2;
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }, [points]);

  return (
    <svg className="sparkline" viewBox="0 0 140 28" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
});
