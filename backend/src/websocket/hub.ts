import type { FastifyInstance } from "fastify";
import "@fastify/websocket";
import type { WebSocket } from "ws";
import Redis from "ioredis";
import { REDIS_KEYS } from "../config/keys.js";
import type { DecisionEvent, WsEvent } from "./aggregator.js";

export class EventHub {
  private readonly sockets = new Set<WebSocket>();
  private readonly pending: WsEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private snapshotProvider: (() => WsEvent) | null = null;

  constructor(
    private readonly publisher: Redis,
    private readonly instanceId: string
  ) {}

  onSnapshot(provider: () => WsEvent): void {
    this.snapshotProvider = provider;
  }

  attach(app: FastifyInstance): void {
    app.get("/ws", { websocket: true }, (socket: WebSocket) => {
      this.sockets.add(socket);
      if (this.snapshotProvider) {
        try {
          socket.send(JSON.stringify({ type: "batch", timestamp: Date.now(), events: [this.snapshotProvider()] }));
        } catch {
          // socket may close immediately
        }
      }
      socket.on("close", () => this.sockets.delete(socket));
      socket.on("error", () => this.sockets.delete(socket));
    });
  }

  local(event: WsEvent): void {
    this.enqueue(event);
  }

  async broadcast(event: WsEvent): Promise<void> {
    this.enqueue(event);
    try {
      await this.publisher.publish(
        REDIS_KEYS.pubsub,
        JSON.stringify({ ...event, origin: this.instanceId })
      );
    } catch {
      // Redis pub/sub is best-effort for dashboard fan-out.
    }
  }

  ingestRemote(raw: string): WsEvent | null {
    try {
      const event = JSON.parse(raw) as WsEvent & { origin?: string };
      if (event.origin === this.instanceId) return null;
      this.enqueue(event);
      return event;
    } catch {
      return null;
    }
  }

  enqueueDecision(event: DecisionEvent | null): void {
    if (!event) return;
    this.enqueue({
      type: "rate_limit_decision",
      timestamp: event.timestamp,
      tenant_id: event.tenant_id,
      allowed: event.allowed,
      remaining: event.remaining
    });
    if (!event.allowed) {
      this.enqueue({
        type: "rate_limit_triggered",
        timestamp: event.timestamp,
        tenant_id: event.tenant_id
      });
    }
  }

  private enqueue(event: WsEvent): void {
    this.pending.push(event);
    if (this.pending.length > 500) this.pending.shift();
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 16);
    }
  }

  private flush(): void {
    this.flushTimer = null;
    if (this.pending.length === 0 || this.sockets.size === 0) {
      this.pending.length = 0;
      return;
    }
    const batch = this.pending.splice(0, this.pending.length);
    const payload = JSON.stringify({ type: "batch", timestamp: Date.now(), events: batch });
    for (const socket of this.sockets) {
      if (socket.readyState !== 1) {
        this.sockets.delete(socket);
        continue;
      }
      try {
        socket.send(payload);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }
}
