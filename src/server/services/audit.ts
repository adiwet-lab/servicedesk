import type { Prisma } from "@prisma/client";
import type { Actor } from "@/server/authz/actor";

type Db = Prisma.TransactionClient;

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  ticketId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

const toJson = (v: unknown) =>
  v === undefined ? undefined : v === null ? (null as unknown as Prisma.InputJsonValue) : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/** Append an audit record. Call inside the same transaction as the mutation. */
export async function audit(db: Db, actor: Pick<Actor, "id" | "ip" | "userAgent"> | null, e: AuditEntry) {
  await db.auditLog.create({
    data: {
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      ticketId: e.ticketId ?? null,
      actorId: actor?.id ?? null,
      oldValue: toJson(e.oldValue),
      newValue: toJson(e.newValue),
      ipAddress: actor?.ip ?? null,
      userAgent: actor?.userAgent?.slice(0, 500) ?? null,
    },
  });
}

/** Shallow diff of two records restricted to `keys`. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>, keys: (keyof T)[]) {
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const k of keys) {
    if (!(k in after)) continue;
    const a = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
    const b = after[k] instanceof Date ? (after[k] as Date).toISOString() : after[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      oldValue[k as string] = a ?? null;
      newValue[k as string] = b ?? null;
    }
  }
  return { oldValue, newValue, changed: Object.keys(newValue).length > 0 };
}
