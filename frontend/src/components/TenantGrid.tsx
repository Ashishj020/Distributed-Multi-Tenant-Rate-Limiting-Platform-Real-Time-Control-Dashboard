import { TenantCard } from "./TenantCard";
import { useStore } from "../state/store";

export function TenantGrid() {
  const tenants = useStore((s) => s.tenants);
  return (
    <section>
      <div className="section-title">
        <h2>Tenants</h2>
        <span className="pill">{tenants.length} configured</span>
      </div>
      <div className="tenant-grid">
        {tenants.map((tenant) => (
          <TenantCard key={tenant.tenant_id} tenant={tenant} />
        ))}
      </div>
    </section>
  );
}
