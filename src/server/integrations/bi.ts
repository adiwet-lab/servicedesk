import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { can } from "@/server/authz/guards";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { audit } from "@/server/services/audit";
import { rateLimiter } from "@/server/ratelimit";
import { generateApiToken, hashApiToken, pseudonym, TOKEN_PREFIX } from "./crypto";

/**
 * Read-only reporting feeds for Power BI (Web connector / Power Query).
 * Tokens are org-wide read credentials created by integrations.manage; only the SHA-256
 * hash is stored. Data minimisation: no descriptions, chat, notes or attachments ever;
 * people are pseudonymous keys unless the token was created with includeNames.
 */
export const BI_SCOPE = "bi.read";
export const MAX_TOP = 5000;

function requireManager(actor: Actor) {
  if (isVendor(actor) || !can(actor, P.INTEGRATIONS_MANAGE)) throw new AuthorizationError("You cannot manage integrations.");
}

export const tokenSchema = z.object({
  name: z.string().trim().min(3).max(80),
  includeNames: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()).default(false),
  expiresInDays: z.preprocess((v) => (v === "" || v == null ? 365 : Number(v)), z.number().int().min(1).max(730)),
});

/** Creates a token and returns the plaintext ONCE. */
export async function createApiToken(actor: Actor, raw: unknown) {
  requireManager(actor);
  const p = tokenSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Invalid token settings");
  const token = generateApiToken();
  const row = await prisma.apiToken.create({
    data: { name: p.data.name, tokenHash: hashApiToken(token), prefix: token.slice(0, TOKEN_PREFIX.length + 6), scopes: [BI_SCOPE],
      includeNames: p.data.includeNames, expiresAt: new Date(Date.now() + p.data.expiresInDays * 86_400_000), createdById: actor.id },
  });
  await audit(prisma, actor, { action: "API_TOKEN_CREATED", entityType: "ApiToken", entityId: row.id, newValue: { name: row.name, includeNames: row.includeNames, expiresAt: row.expiresAt } });
  return { id: row.id, token };
}

export async function revokeApiToken(actor: Actor, id: string) {
  requireManager(actor);
  const t = await prisma.apiToken.findUnique({ where: { id } });
  if (!t) throw new NotFoundError();
  if (t.revokedAt) return;
  await prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(prisma, actor, { action: "API_TOKEN_REVOKED", entityType: "ApiToken", entityId: id, oldValue: { name: t.name } });
}

export async function listApiTokens(actor: Actor) {
  requireManager(actor);
  return prisma.apiToken.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, prefix: true, includeNames: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true, createdBy: { select: { displayName: true } } } });
}

// ───────────────────────────── Request handling ─────────────────────────────

export class BiError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export async function authenticateBi(authHeader: string | null) {
  const m = /^Bearer\s+(\S+)$/i.exec(authHeader ?? "");
  if (!m || !m[1]!.startsWith(TOKEN_PREFIX)) throw new BiError(401, "Missing or malformed bearer token.");
  const t = await prisma.apiToken.findUnique({ where: { tokenHash: hashApiToken(m[1]!) } });
  if (!t || t.revokedAt) throw new BiError(401, "Invalid or revoked token.");
  if (t.expiresAt && t.expiresAt <= new Date()) throw new BiError(403, "Token expired.");
  if (!t.scopes.includes(BI_SCOPE)) throw new BiError(403, "Token lacks the bi.read scope.");
  if (!rateLimiter.hit(`bi:${t.id}`, 120, 60_000)) throw new BiError(429, "Rate limit exceeded (120 requests/minute).");
  // Throttle last-used writes to one per minute.
  if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 60_000) await prisma.apiToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } });
  return t;
}

export const FEEDS = ["tickets", "tasks", "sla-events", "teams", "categories", "priorities", "statuses", "branches", "departments"] as const;
export type Feed = (typeof FEEDS)[number];

export function parsePaging(sp: URLSearchParams) {
  const top = Math.min(Math.max(Number(sp.get("$top") ?? 1000) || 1000, 1), MAX_TOP);
  const skip = Math.max(Number(sp.get("$skip") ?? 0) || 0, 0);
  const ms = sp.get("modifiedSince");
  let modifiedSince: Date | null = null;
  if (ms) {
    modifiedSince = new Date(ms);
    if (Number.isNaN(modifiedSince.getTime())) throw new BiError(400, "modifiedSince must be an ISO-8601 date-time.");
  }
  return { top, skip, modifiedSince };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function runFeed(feed: Feed, sp: URLSearchParams, token: { includeNames: boolean }) {
  const { top, skip, modifiedSince } = parsePaging(sp);
  const since = modifiedSince ? { updatedAt: { gte: modifiedSince } } : {};
  const page = { skip, take: top + 1 };
  let rows: Record<string, unknown>[];
  switch (feed) {
    case "tickets": {
      const where: Prisma.TicketWhereInput = { deletedAt: null, ...since };
      const list = await prisma.ticket.findMany({
        where, ...page, orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        select: {
          id: true, number: true, subject: true, isConfidential: true, createdAt: true, updatedAt: true, firstResponseAt: true, resolvedAt: true, closedAt: true,
          statusId: true, priorityId: true, categoryId: true, subcategoryId: true, ownerTeamId: true, assignedAgentId: true, requesterId: true,
          companyId: true, departmentId: true, branchId: true, responseDueAt: true, resolutionDueAt: true, responseBreached: true, resolutionBreached: true,
          slaPausedMinutes: true, isMajorIncident: true, majorIncidentStatus: true, parentIncidentId: true, impactScope: true, approvalStatus: true,
          requester: { select: { displayName: true } }, assignedAgent: { select: { displayName: true } },
        },
      });
      rows = list.map((t) => ({
        id: t.id, number: t.number,
        ...(token.includeNames ? { subject: t.isConfidential ? null : t.subject, requesterName: t.requester.displayName, agentName: t.assignedAgent?.displayName ?? null } : {}),
        requesterKey: pseudonym(t.requesterId), agentKey: pseudonym(t.assignedAgentId), isConfidential: t.isConfidential,
        statusId: t.statusId, priorityId: t.priorityId, categoryId: t.categoryId, subcategoryId: t.subcategoryId, ownerTeamId: t.ownerTeamId,
        companyId: t.companyId, departmentId: t.departmentId, branchId: t.branchId,
        createdAt: iso(t.createdAt), updatedAt: iso(t.updatedAt), firstResponseAt: iso(t.firstResponseAt), resolvedAt: iso(t.resolvedAt), closedAt: iso(t.closedAt),
        responseDueAt: iso(t.responseDueAt), resolutionDueAt: iso(t.resolutionDueAt), responseBreached: t.responseBreached, resolutionBreached: t.resolutionBreached,
        slaPausedMinutes: t.slaPausedMinutes, isMajorIncident: t.isMajorIncident, majorIncidentStatus: t.majorIncidentStatus, parentIncidentId: t.parentIncidentId,
        impactScope: t.impactScope, approvalStatus: t.approvalStatus,
      }));
      break;
    }
    case "tasks": {
      const list = await prisma.ticketTask.findMany({
        where: { ...since }, ...page, orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        select: { id: true, number: true, ticketId: true, teamId: true, assignedAgentId: true, status: true, priorityId: true, isRequired: true, dueDate: true, completedAt: true, createdAt: true, updatedAt: true,
          assignedAgent: { select: { displayName: true } } },
      });
      rows = list.map((t) => ({
        id: t.id, number: t.number, ticketId: t.ticketId, teamId: t.teamId, agentKey: pseudonym(t.assignedAgentId),
        ...(token.includeNames ? { agentName: t.assignedAgent?.displayName ?? null } : {}),
        status: t.status, priorityId: t.priorityId, isRequired: t.isRequired, dueDate: iso(t.dueDate), completedAt: iso(t.completedAt), createdAt: iso(t.createdAt), updatedAt: iso(t.updatedAt),
      }));
      break;
    }
    case "sla-events": {
      const list = await prisma.slaEvent.findMany({
        where: modifiedSince ? { createdAt: { gte: modifiedSince } } : {}, ...page, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, ticketId: true, clock: true, type: true, detail: true, createdAt: true },
      });
      rows = list.map((e) => ({ ...e, createdAt: iso(e.createdAt) }));
      break;
    }
    case "teams": rows = await prisma.supportTeam.findMany({ ...page, orderBy: { id: "asc" }, select: { id: true, code: true, name: true, type: true, isActive: true } }); break;
    case "categories": rows = await prisma.category.findMany({ ...page, orderBy: { id: "asc" }, select: { id: true, code: true, name: true, parentId: true, isActive: true } }); break;
    case "priorities": rows = await prisma.priority.findMany({ ...page, orderBy: { id: "asc" }, select: { id: true, code: true, name: true, level: true } }); break;
    case "statuses": rows = await prisma.ticketStatus.findMany({ ...page, orderBy: { id: "asc" }, select: { id: true, code: true, name: true, kind: true, order: true } }); break;
    case "branches": rows = await prisma.branch.findMany({ ...page, orderBy: { id: "asc" }, select: { id: true, code: true, name: true, companyId: true } }); break;
    case "departments": rows = await prisma.department.findMany({ ...page, orderBy: { id: "asc" }, select: { id: true, code: true, name: true, companyId: true } }); break;
  }
  const more = rows.length > top;
  const value = more ? rows.slice(0, top) : rows;
  let nextLink: string | null = null;
  if (more) {
    const n = new URLSearchParams(sp);
    n.set("$skip", String(skip + top));
    n.set("$top", String(top));
    nextLink = `?${n.toString()}`;
  }
  return { value, count: value.length, nextLink };
}
