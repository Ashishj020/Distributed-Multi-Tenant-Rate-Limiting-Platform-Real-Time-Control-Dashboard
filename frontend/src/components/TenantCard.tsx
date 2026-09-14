import { memo } from "react";
import { UtilizationRing } from "../charts/UtilizationRing";
import { Sparkline } from "../charts/Sparkline";
import type { TenantLiveStats } from "../types";

const STATUS_LABEL: Record<TenantLiveStats["status"], string> = {
  idle: "Idle",
  healthy: "Live",
  approaching: "Warm",
  critical: "Hot",
  limited: "Limited"
};

export const TenantCard = memo(function TenantCard({ tenant }: { tenant: TenantLiveStats }) {
  const used = Math.max(0, tenant.limit - tenant.remaining);
  const bar = Math.min(100, tenant.utilization * 100);
  return (
    <article className={`glass tenant-card ${tenant.status === "limited" ? "limited" : ""}`}>
      <header className="tenant-head">
        <span className="tenant-id">{tenant.tenant_id}</span>
        <span className={`status ${tenant.status}`}>● {STATUS_LABEL[tenant.status]}</span>
      </header>
      <div className="ring-wrap">
        <UtilizationRing value={tenant.utilization} />
        <div className="tenant-meta">
          <div>
            <strong>
              {used} / {tenant.limit}
            </strong>{" "}
            requests
          </div>
          <div>{tenant.remaining} remaining</div>
          <div>
            {tenant.allowed.toLocaleString()} allowed
          </div>
          <div>{tenant.rejected.toLocaleString()} rejected</div>
          <div>{tenant.rps.toFixed(1)} req/s</div>
        </div>
      </div>
      <div className="bar">
        <span style={{ width: `${bar}%` }} />
      </div>
      <Sparkline
        points={tenant.sparkline}
        color={tenant.status === "limited" ? "#f87171" : tenant.status === "critical" ? "#fb923c" : "#7dd3fc"}
      />
    </article>
  );
});
