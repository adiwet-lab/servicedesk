/**
 * Realtime event bus. Events are SIGNALS only ({type, ticketId, ids}) — never
 * message bodies or other protected data. Clients re-fetch through authorized
 * server actions. The Socket.IO server registers itself as the emitter; the
 * registry lives on globalThis because the custom server and the Next.js
 * bundle are separate module graphs in the same process.
 */
export interface RealtimeEvent {
  room: string;
  event: string;
  payload: Record<string, unknown>;
}
export interface RealtimeEmitter {
  emit(e: RealtimeEvent): void;
}

const g = globalThis as unknown as { __rtEmitters?: Set<RealtimeEmitter> };
const emitters = (g.__rtEmitters ??= new Set());

export function registerEmitter(e: RealtimeEmitter): () => void {
  emitters.add(e);
  return () => emitters.delete(e);
}

export function emitNow(e: RealtimeEvent) {
  for (const em of emitters) {
    try {
      em.emit(e);
    } catch (err) {
      console.error("[realtime] emit failed", err);
    }
  }
}

export const rooms = {
  user: (id: string) => `user:${id}`,
  ticket: (id: string) => `ticket:${id}`,
  ticketInternal: (id: string) => `ticket:${id}:internal`,
};

/** Per-transaction queues so events are only emitted after COMMIT (see db-tx.ts). */
const pending = new WeakMap<object, RealtimeEvent[]>();

export function attachQueue(tx: object, queue: RealtimeEvent[]) {
  pending.set(tx, queue);
}

/** Queue an event for after-commit delivery; emits on the next tick when not inside a wrapped transaction. */
export function queueEvent(tx: object | null | undefined, e: RealtimeEvent) {
  const q = tx ? pending.get(tx) : undefined;
  if (q) q.push(e);
  else setTimeout(() => emitNow(e), 0);
}
