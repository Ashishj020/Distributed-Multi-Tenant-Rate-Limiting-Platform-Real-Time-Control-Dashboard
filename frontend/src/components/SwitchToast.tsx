import { useEffect } from "react";
import { ALGORITHM_LABELS } from "../types";
import { useStore } from "../state/store";

export function SwitchToast() {
  const toast = useStore((s) => s.toast);
  const dismiss = useStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(dismiss, 4200);
    return () => window.clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div className="toast" role="status">
      <b>✓ Algorithm switched</b>
      <div className="flow">
        {ALGORITHM_LABELS[toast.from]}
        <br />
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↓
        <br />
        {ALGORITHM_LABELS[toast.to]}
      </div>
    </div>
  );
}
