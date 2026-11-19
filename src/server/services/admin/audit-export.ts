import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { can } from "@/server/authz/guards";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { csvEscape } from "@/server/domain/analytics";
import { audit } from "@/server/services/audit";
import { auditWhere, type AuditQuery } from "./system";

/**
 * Audit-log export for archival (immutable storage / Log Analytics) and investigations.
 * The log itself stays append-only — retention is achieved by exporting, never by deleting.
 * Keyset pagination (createdAt, id) streams any volume with bounded memory.
 */
export const AUDIT_EXPORT_MAX_ROWS = 500_000;
export const AUDIT_EXPORT_MAX_DAYS = 366;
const PAGE = 2000;

export type AuditExportFormat = "csv" | "ndjson";
const HEADERS = ["id", "createdAt", "action", "entityType", "entityId", "actorId", "actorEmail", "ticketId", "ticketNumber", "ipAddress", "userAgent", "oldValue", "newValue"];

/** Validates the range (default: last 30 days) and returns the effective filter. */
export function exportRange(q: AuditQuery, now = new Date()) {
  const to = q.to ?? now.toISOString().slice(0, 10);
  const from = q.from ?? new Date(Date.parse(to) - 29 * 86_400_000).toISOString().slice(0, 10);
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (!Number.isFinite(days) || days < 0) throw new ValidationError("Invalid date range.");
  if (days > AUDIT_EXPORT_MAX_DAYS) throw new ValidationError(`Export at most ${AUDIT_EXPORT_MAX_DAYS} days at a time.`);
  return { ...q, from, to };
}

export async function startAuditExport(actor: Actor | null, raw: AuditQuery, format: AuditExportFormat) {
  if (actor && (isVendor(actor) || !can(actor, P.AUDIT_READ))) throw new AuthorizationError("You cannot export audit logs.");
  const q = exportRange(raw);
  const where = auditWhere(q);
  const total = await prisma.auditLog.count({ where });
  if (total > AUDIT_EXPORT_MAX_ROWS) throw new ValidationError(`The selection has ${total} rows — narrow the range (max ${AUDIT_EXPORT_MAX_ROWS}).`);
  // The export is itself audited before any data leaves the system.
  await audit(prisma, actor, { action: actor ? "AUDIT_EXPORTED" : "AUDIT_ARCHIVE_EXPORTED", entityType: "AuditLog", entityId: null, newValue: { ...q, format, rows: total } as Prisma.InputJsonValue });
  return { total, filter: q, chunks: auditChunks(where, format) };
}

async function* auditChunks(where: Prisma.AuditLogWhereInput, format: AuditExportFormat): AsyncGenerator<string> {
  if (format === "csv") yield "\uFEFF" + HEADERS.join(",") + "\r\n";
  let cursor: { createdAt: Date; id: string } | null = null;
  for (;;) {
    const rows: Prisma.AuditLogGetPayload<{ include: { actor: { select: { email: true } }; ticket: { select: { number: true } } } }>[] = await prisma.auditLog.findMany({
      where: cursor ? { AND: [where, { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }] } : where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: PAGE,
      include: { actor: { select: { email: true } }, ticket: { select: { number: true } } },
    });
    if (!rows.length) return;
    let out = "";
    for (const r of rows) {
      const rec = {
        id: r.id, createdAt: r.createdAt.toISOString(), action: r.action, entityType: r.entityType, entityId: r.entityId, actorId: r.actorId,
        actorEmail: r.actor?.email ?? null, ticketId: r.ticketId, ticketNumber: r.ticket?.number ?? null, ipAddress: r.ipAddress, userAgent: r.userAgent,
        oldValue: r.oldValue, newValue: r.newValue,
      };
      out += format === "ndjson"
        ? JSON.stringify(rec) + "\n"
        : HEADERS.map((h) => { const v = rec[h as keyof typeof rec]; return csvEscape(v != null && typeof v === "object" ? JSON.stringify(v) : v); }).join(",") + "\r\n";
    }
    yield out;
    const last = rows[rows.length - 1]!;
    cursor = { createdAt: last.createdAt, id: last.id };
    if (rows.length < PAGE) return;
  }
}
