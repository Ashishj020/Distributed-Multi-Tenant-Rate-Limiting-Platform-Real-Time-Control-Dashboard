import { useStore } from "../state/store";

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export function connectRealtime(): () => void {
  let closed = false;
  let socket: WebSocket | null = null;
  let retry = 500;
  let timer: number | undefined;

  const connect = () => {
    if (closed) return;
    socket = new WebSocket(wsUrl());
    socket.onopen = () => {
      retry = 500;
      useStore.getState().setConnected(true);
    };
    socket.onclose = () => {
      useStore.getState().setConnected(false);
      if (closed) return;
      timer = window.setTimeout(connect, retry);
      retry = Math.min(retry * 1.6, 5000);
    };
    socket.onerror = () => {
      socket?.close();
    };
    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data as string) as {
          type?: string;
          events?: Record<string, unknown>[];
        };
        const events = payload.type === "batch" && Array.isArray(payload.events) ? payload.events : [payload];
        const apply = useStore.getState().applyEvent;
        for (const event of events) apply(event);
      } catch {
        // ignore malformed frames
      }
    };
  };

  connect();
  return () => {
    closed = true;
    if (timer) window.clearTimeout(timer);
    socket?.close();
  };
}
