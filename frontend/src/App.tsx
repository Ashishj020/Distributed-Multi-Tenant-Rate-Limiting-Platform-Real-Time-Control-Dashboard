import { useEffect } from "react";
import { Hero } from "./components/Hero";
import { ComparisonTable } from "./components/ComparisonTable";
import { StressPanel } from "./components/StressPanel";
import { TenantGrid } from "./components/TenantGrid";
import { RequestStream } from "./components/RequestStream";
import { SwitchToast } from "./components/SwitchToast";
import { connectRealtime } from "./websocket/client";

export default function App() {
  useEffect(() => connectRealtime(), []);

  return (
    <div className="app">
      <Hero />
      <div className="grid-2">
        <ComparisonTable />
        <StressPanel />
      </div>
      <TenantGrid />
      <RequestStream />
      <SwitchToast />
    </div>
  );
}
