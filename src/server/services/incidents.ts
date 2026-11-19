import { z } from "zod";
import type { MajorIncidentStatus, Prisma } from "@prisma/client";
import { IMPACT_LABEL, IMPACT_SCOPES, validateImpact } from "@/server/domain/impact";
import { prisma } from "@/server/db";
import { transaction } from "@/server/db-tx";
import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { can, canAny } from "@/server/authz/guards";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { canWorkTicket, ticketScopeWhere } from "@/server/authz/scope";
import { audit } from "./audit";
import { notifyUsers, teamMemberIds } from "./notifications";
import { applyStatusChange, ticketSlaSelect } from "./sla";
import { createTicket } from "./tickets";

export { IMPACT_LABEL, validateImpact };
export const MI_STATUS_LABEL: Record<MajorIncidentStatus, string> = {
  INVESTIGATING: "Investigating", IDENTIFIED: "Identified", MONITORING: "Monitoring", RESOLVED: "Resolved",
};

const ACTIVE_KINDS = ["NEW", "OPEN", "WAITING"] as const;

// ───────────────────────────── Validation (pure) ─────────────────────────────

export const impactSchema = z.object({
  impactScope: z.enum(IMPACT_SCOPES),
  branchIds: z.array(z.string().min(1).max(50)).max(500).default([]),
  impactedUserCount: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(1).max(1_000_000).nullable()).default(null),
});
export type ImpactInput = z.infer<typeof impactSchema>;


// ───────────────────────────── Loading ─────────────────────────────

async function loadScoped(actor: Actor, ticketId: string) {
  const t = await prisma.ticket.findFirst({
    where: { AND: [ticketScopeWhere(actor), { OR: [{ id: ticketId }, { number: ticketId }] }] },
    include: { status: true, impactedBranches: true, _count: { select: { childTickets: true } } },
  });
  if (!t) throw new NotFoundError("Ticket not found or you do not have access.");
  return t;
}

function requireIncidentManager(actor: Actor, ticket: { ownerTeamId: string | null; assignedAgentId: string | null }) {
  if (isVendor(actor) || !can(actor, P.INCIDENT_MANAGE)) throw new AuthorizationError("You cannot manage major incidents.");
  if (!can(actor, P.TICKET_READ_ALL) && !canWorkTicket(actor, ticket)) throw new AuthorizationError("You cannot manage this ticket.");
}

/** Requesters of the incident and its linked tickets + owner/supporting team members. */
async function incidentAudience(tx: Prisma.TransactionClient, ticketId: string) {
  const t = await tx.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { requesterId: true, ownerTeamId: true, assignedAgentId: true, supportingTeams: { select: { teamId: true } },
      childTickets: { where: { deletedAt: null }, select: { requesterId: true, assignedAgentId: true } } },
  });
  const staff = [
    ...(await teamMemberIds(tx, t.ownerTeamId)),
    ...(await Promise.all(t.supportingTeams.map((s) => teamMemberIds(tx, s.teamId)))).flat(),
    t.assignedAgentId, ...t.childTickets.map((c) => c.assignedAgentId),
  ];
  const requesters = [t.requesterId, ...t.childTickets.map((c) => c.requesterId)];
  return { staff, requesters };
}

// ───────────────────────────── Impact ─────────────────────────────

export async function setImpact(actor: Actor, ticketId: string, raw: unknown) {
  const t = await loadScoped(actor, ticketId);
  if (isVendor(actor) || !canWorkTicket(actor, t)) throw new AuthorizationError("You cannot change the impact of this ticket.");
  const parsed = impactSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid impact");
  const input = parsed.data;
  const err = validateImpact(input);
  if (err) throw new ValidationError(err);
  const branches = [...new Set(input.branchIds)];
  if (branches.length) {
    const found = await prisma.branch.count({ where: { id: { in: branches }, deletedAt: null } });
    if (found !== branches.length) throw new ValidationError("Unknown branch selected.");
  }
  await transaction(async (tx) => {
    await tx.ticket.update({ where: { id: t.id }, data: { impactScope: input.impactScope, impactedUserCount: input.impactedUserCount } });
    await tx.ticketImpactedBranch.deleteMany({ where: { ticketId: t.id } });
    if (branches.length) await tx.ticketImpactedBranch.createMany({ data: branches.map((branchId) => ({ ticketId: t.id, branchId })) });
    await tx.ticketHistory.create({
      data: { ticketId: t.id, actorId: actor.id, action: "IMPACT_CHANGED", field: "Impact",
        oldValue: t.impactScope ? IMPACT_LABEL[t.impactScope] : null,
        newValue: `${IMPACT_LABEL[input.impactScope]}${branches.length ? ` · ${branches.length} branch(es)` : ""}${input.impactedUserCount ? ` · ~${input.impactedUserCount} users` : ""}` },
    });
    await audit(tx, actor, { action: "IMPACT_CHANGED", entityType: "Ticket", entityId: t.id, ticketId: t.id,
      oldValue: { impactScope: t.impactScope, branches: t.impactedBranches.map((b) => b.branchId), impactedUserCount: t.impactedUserCount },
      newValue: { impactScope: input.impactScope, branches, impactedUserCount: input.impactedUserCount } });
  });
}

// ───────────────────────────── Major incident lifecycle ─────────────────────────────

export const declareSchema = z.object({ message: z.string().trim().min(5, "Describe the incident (min. 5 characters)").max(5000) });

export async function declareMajorIncident(actor: Actor, ticketId: string, raw: unknown) {
  const t = await loadScoped(actor, ticketId);
  requireIncidentManager(actor, t);
  if (t.isMajorIncident) throw new ValidationError("This ticket is already a major incident.");
  if (t.parentIncidentId) throw new ValidationError("A ticket linked to another incident cannot be declared a major incident. Unlink it first.");
  if (t.isConfidential) throw new ValidationError("Confidential tickets cannot be declared major incidents.");
  if (!ACTIVE_KINDS.includes(t.status.kind as (typeof ACTIVE_KINDS)[number])) throw new ValidationError("Only open tickets can be declared major incidents.");
  if (!t.impactScope) throw new ValidationError("Set the impact (scope and branches) before declaring a major incident.");
  const { message } = declareSchema.parse(raw);
  const now = new Date();
  await transaction(async (tx) => {
    await tx.ticket.update({ where: { id: t.id }, data: { isMajorIncident: true, majorIncidentStatus: "INVESTIGATING", majorDeclaredAt: now, majorDeclaredById: actor.id } });
    await tx.incidentUpdate.create({ data: { ticketId: t.id, authorId: actor.id, status: "INVESTIGATING", message } });
    await tx.ticketHistory.create({ data: { ticketId: t.id, actorId: actor.id, action: "MAJOR_DECLARED", newValue: "Major incident declared", reason: message } });
    await audit(tx, actor, { action: "MAJOR_INCIDENT_DECLARED", entityType: "Ticket", entityId: t.id, ticketId: t.id, newValue: { message, impactScope: t.impactScope } });
    const aud = await incidentAudience(tx, t.id);
    const leads = await teamMemberIds(tx, t.ownerTeamId, true);
    await notifyUsers(tx, [...aud.staff, ...leads], {
      type: "MAJOR_INCIDENT", title: `Major incident declared: ${t.number}`, body: `${t.subject} — ${message.slice(0, 140)}`, ticketId: t.id, link: `/admin/tickets/${t.number}`,
    }, actor);
    await notifyUsers(tx, aud.requesters, {
      type: "MAJOR_INCIDENT", title: `Known issue: ${t.subject}`, body: message.slice(0, 160), ticketId: t.id, link: `/tickets/${t.number}`,
    }, actor);
  });
}

export const updateSchema = z.object({
  status: z.enum(["INVESTIGATING", "IDENTIFIED", "MONITORING"]),
  message: z.string().trim().min(3).max(5000),
});

export async function postIncidentUpdate(actor: Actor, ticketId: string, raw: unknown) {
  const t = await loadScoped(actor, ticketId);
  requireIncidentManager(actor, t);
  if (!t.isMajorIncident || t.majorIncidentStatus === "RESOLVED") throw new ValidationError("This ticket is not an active major incident.");
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid update");
  const u = parsed.data;
  await transaction(async (tx) => {
    await tx.ticket.update({ where: { id: t.id }, data: { majorIncidentStatus: u.status } });
    await tx.incidentUpdate.create({ data: { ticketId: t.id, authorId: actor.id, status: u.status, message: u.message } });
    await tx.ticketHistory.create({ data: { ticketId: t.id, actorId: actor.id, action: "INCIDENT_UPDATE", field: "Major incident",
      oldValue: t.majorIncidentStatus ? MI_STATUS_LABEL[t.majorIncidentStatus] : null, newValue: MI_STATUS_LABEL[u.status], reason: u.message } });
    await audit(tx, actor, { action: "MAJOR_INCIDENT_UPDATED", entityType: "Ticket", entityId: t.id, ticketId: t.id, newValue: u });
    const aud = await incidentAudience(tx, t.id);
    await notifyUsers(tx, aud.staff, { type: "MAJOR_INCIDENT", title: `${t.number} · ${MI_STATUS_LABEL[u.status]}`, body: u.message.slice(0, 160), ticketId: t.id, link: `/admin/tickets/${t.number}` }, actor);
    await notifyUsers(tx, aud.requesters, { type: "MAJOR_INCIDENT", title: `Update: ${t.subject} (${MI_STATUS_LABEL[u.status]})`, body: u.message.slice(0, 160), ticketId: t.id }, actor);
  });
}

export async function linkToIncident(actor: Actor, parentId: string, childRef: string) {
  const parent = await loadScoped(actor, parentId);
  requireIncidentManager(actor, parent);
  if (!parent.isMajorIncident || parent.majorIncidentStatus === "RESOLVED") throw new ValidationError("Tickets can only be linked to an active major incident.");
  const child = await loadScoped(actor, childRef);
  if (child.id === parent.id) throw new ValidationError("A ticket cannot be linked to itself.");
  if (child.isMajorIncident || child._count.childTickets > 0) throw new ValidationError("A major incident (or a ticket with linked tickets) cannot be linked under another incident.");
  if (child.parentIncidentId === parent.id) throw new ValidationError("Already linked.");
  if (child.parentIncidentId) throw new ValidationError("This ticket is already linked to another incident.");
  await transaction(async (tx) => {
    await tx.ticket.update({ where: { id: child.id }, data: { parentIncidentId: parent.id } });
    await tx.ticketHistory.create({ data: { ticketId: child.id, actorId: actor.id, action: "LINKED_TO_INCIDENT", newValue: parent.number } });
    await tx.ticketHistory.create({ data: { ticketId: parent.id, actorId: actor.id, action: "INCIDENT_LINKED", newValue: child.number } });
    await audit(tx, actor, { action: "INCIDENT_LINKED", entityType: "Ticket", entityId: parent.id, ticketId: parent.id, newValue: { child: child.number } });
    await notifyUsers(tx, [child.requesterId], {
      type: "MAJOR_INCIDENT", title: `${child.number} is part of a known issue`, body: `We are working on ${parent.subject}. You will receive updates here.`, ticketId: child.id, link: `/tickets/${child.number}`,
    }, actor);
  });
}

export async function unlinkFromIncident(actor: Actor, childRef: string) {
  const child = await loadScoped(actor, childRef);
  if (!child.parentIncidentId) throw new ValidationError("This ticket is not linked to an incident.");
  const parent = await prisma.ticket.findUniqueOrThrow({ where: { id: child.parentIncidentId }, select: { id: true, number: true, ownerTeamId: true, assignedAgentId: true } });
  requireIncidentManager(actor, parent);
  await transaction(async (tx) => {
    await tx.ticket.update({ where: { id: child.id }, data: { parentIncidentId: null } });
    await tx.ticketHistory.create({ data: { ticketId: child.id, actorId: actor.id, action: "UNLINKED_FROM_INCIDENT", oldValue: parent.number } });
    await audit(tx, actor, { action: "INCIDENT_UNLINKED", entityType: "Ticket", entityId: parent.id, ticketId: parent.id, oldValue: { child: child.number } });
  });
}

export const resolveSchema = z.object({
  summary: z.string().trim().min(5, "Describe the resolution (min. 5 characters)").max(5000),
  cascade: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()).default(false),
});

/**
 * Resolves the major incident: final RESOLVED update and, optionally, resolves every
 * active linked ticket (only where the workflow has a transition to a RESOLVED-kind
 * status and no required task is open). Returns what was resolved / skipped.
 */
export async function resolveMajorIncident(actor: Actor, ticketId: string, raw: unknown) {
  const t = await loadScoped(actor, ticketId);
  requireIncidentManager(actor, t);
  if (!t.isMajorIncident || t.majorIncidentStatus === "RESOLVED") throw new ValidationError("This ticket is not an active major incident.");
  const parsed = resolveSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
  const { summary, cascade } = parsed.data;
  const now = new Date();
  const resolved: string[] = [];
  const skipped: { number: string; reason: string }[] = [];

  await transaction(async (tx) => {
    await tx.ticket.update({ where: { id: t.id }, data: { majorIncidentStatus: "RESOLVED" } });
    await tx.incidentUpdate.create({ data: { ticketId: t.id, authorId: actor.id, status: "RESOLVED", message: summary } });
    await tx.ticketHistory.create({ data: { ticketId: t.id, actorId: actor.id, action: "INCIDENT_UPDATE", field: "Major incident",
      oldValue: t.majorIncidentStatus ? MI_STATUS_LABEL[t.majorIncidentStatus] : null, newValue: "Resolved", reason: summary } });
    await audit(tx, actor, { action: "MAJOR_INCIDENT_RESOLVED", entityType: "Ticket", entityId: t.id, ticketId: t.id, newValue: { summary, cascade } });
    const aud = await incidentAudience(tx, t.id);
    await notifyUsers(tx, [...aud.staff, ...aud.requesters], { type: "MAJOR_INCIDENT", title: `Resolved: ${t.subject}`, body: summary.slice(0, 160), ticketId: t.id }, actor);
  });

  if (cascade) {
    const children = await prisma.ticket.findMany({
      where: { parentIncidentId: t.id, deletedAt: null, status: { kind: { in: [...ACTIVE_KINDS] } } },
      select: { ...ticketSlaSelect, number: true, statusId: true, requesterId: true, status: { select: { name: true } },
        tasks: { select: { isRequired: true, status: true } } },
    });
    for (const c of children) {
      if (c.approvalStatus === "PENDING") { skipped.push({ number: c.number, reason: "awaiting approval" }); continue; }
      if (c.tasks.some((k) => k.isRequired && k.status !== "COMPLETED" && k.status !== "CANCELLED")) {
        skipped.push({ number: c.number, reason: "required tasks open" });
        continue;
      }
      const tr = await prisma.workflowTransition.findFirst({ where: { fromStatusId: c.statusId, toStatus: { kind: "RESOLVED", isActive: true } }, include: { toStatus: true } });
      if (!tr) { skipped.push({ number: c.number, reason: `no transition from ${c.status.name}` }); continue; }
      await transaction(async (tx) => {
        const moved = await tx.ticket.updateMany({ where: { id: c.id, statusId: c.statusId }, data: { statusId: tr.toStatusId, resolutionSummary: summary, resolvedAt: now, waitingReason: null } });
        if (moved.count !== 1) { skipped.push({ number: c.number, reason: "changed concurrently" }); return; }
        const slaData = await applyStatusChange(tx, c, tr.toStatus, now);
        if (Object.keys(slaData).length) await tx.ticket.update({ where: { id: c.id }, data: slaData });
        await tx.ticketHistory.create({ data: { ticketId: c.id, actorId: actor.id, action: "STATUS_CHANGED", field: "status", oldValue: c.status.name, newValue: tr.toStatus.name, reason: `Resolved with major incident ${t.number}: ${summary}` } });
        await audit(tx, actor, { action: "STATUS_CHANGED", entityType: "Ticket", entityId: c.id, ticketId: c.id, oldValue: { status: c.status.name }, newValue: { status: tr.toStatus.name, viaIncident: t.number } });
        await notifyUsers(tx, [c.requesterId], { type: "TICKET_RESOLVED", title: `${c.number} resolved`, body: summary.slice(0, 160), ticketId: c.id, link: `/tickets/${c.number}` }, actor);
        resolved.push(c.number);
      });
    }
  }
  return { resolved, skipped };
}

// ───────────────────────────── Read models ─────────────────────────────

export async function getIncidentPanel(actor: Actor, ticketId: string) {
  const t = await prisma.ticket.findFirst({
    where: { AND: [ticketScopeWhere(actor), { id: ticketId }] },
    select: {
      id: true, number: true, isMajorIncident: true, majorIncidentStatus: true, majorDeclaredAt: true, impactScope: true, impactedUserCount: true,
      ownerTeamId: true, assignedAgentId: true, status: { select: { kind: true } }, isConfidential: true,
      majorDeclaredBy: { select: { displayName: true } },
      impactedBranches: { select: { branch: { select: { id: true, name: true } } } },
      parentIncident: { select: { id: true, number: true, subject: true, majorIncidentStatus: true } },
      incidentUpdates: { orderBy: { createdAt: "desc" }, include: { author: { select: { displayName: true } } } },
      childTickets: { where: { AND: [ticketScopeWhere(actor), { deletedAt: null }] }, select: { id: true, number: true, subject: true, status: { select: { name: true, color: true, kind: true } }, requester: { select: { displayName: true } } }, orderBy: { createdAt: "asc" } },
      _count: { select: { childTickets: true } },
    },
  });
  if (!t) throw new NotFoundError();
  const manage = !isVendor(actor) && can(actor, P.INCIDENT_MANAGE) && (can(actor, P.TICKET_READ_ALL) || canWorkTicket(actor, t));
  return {
    ...t,
    canSetImpact: !isVendor(actor) && canWorkTicket(actor, t),
    canManage: manage,
    canDeclare: manage && !t.isMajorIncident && !t.parentIncident && !t.isConfidential && ACTIVE_KINDS.includes(t.status.kind as (typeof ACTIVE_KINDS)[number]),
  };
}

/** Incident dashboard rows (scope-filtered). */
export async function listMajorIncidents(actor: Actor, opts: { includeResolved?: boolean } = {}) {
  if (!canAny(actor, [P.INCIDENT_MANAGE, P.DASHBOARD_SUPPORT, P.DASHBOARD_MANAGEMENT, P.TICKET_READ_ALL])) throw new AuthorizationError();
  const orgWide = !isVendor(actor) && canAny(actor, [P.DASHBOARD_MANAGEMENT, P.TICKET_READ_ALL]);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.ticket.findMany({
    where: {
      AND: [
        orgWide ? { deletedAt: null } : ticketScopeWhere(actor),
        { isMajorIncident: true },
        opts.includeResolved ? { OR: [{ majorIncidentStatus: { not: "RESOLVED" } }, { updatedAt: { gte: since } }] } : { majorIncidentStatus: { not: "RESOLVED" } },
      ],
    },
    orderBy: [{ majorDeclaredAt: "desc" }],
    select: {
      id: true, number: true, subject: true, majorIncidentStatus: true, majorDeclaredAt: true, impactScope: true, impactedUserCount: true,
      resolutionDueAt: true, slaPausedAt: true, resolutionBreached: true,
      priority: { select: { code: true, color: true } }, ownerTeam: { select: { name: true } }, assignedAgent: { select: { displayName: true } },
      impactedBranches: { select: { branch: { select: { name: true } } } },
      incidentUpdates: { orderBy: { createdAt: "desc" }, take: 1, select: { message: true, createdAt: true, status: true } },
      _count: { select: { childTickets: true } },
    },
  });
  const branchCounts = new Map<string, number>();
  for (const r of rows) if (r.majorIncidentStatus !== "RESOLVED") for (const b of r.impactedBranches) branchCounts.set(b.branch.name, (branchCounts.get(b.branch.name) ?? 0) + 1);
  return { rows, impactedBranches: [...branchCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) };
}

/**
 * Active major incidents relevant to an employee (by branch / company impact) —
 * public information only (subject, status, latest update), used for the portal banner.
 */
export async function activeIncidentsFor(actor: Actor) {
  const or: Prisma.TicketWhereInput[] = [{ impactScope: "MULTIPLE_COMPANIES" }];
  if (actor.companyId) or.push({ impactScope: "COMPANY_WIDE", companyId: actor.companyId });
  if (actor.branchId) or.push({ impactedBranches: { some: { branchId: actor.branchId } } });
  const rows = await prisma.ticket.findMany({
    where: { deletedAt: null, isMajorIncident: true, isConfidential: false, majorIncidentStatus: { not: "RESOLVED" }, OR: or },
    orderBy: { majorDeclaredAt: "desc" }, take: 5,
    select: {
      id: true, number: true, subject: true, majorIncidentStatus: true, majorDeclaredAt: true, impactScope: true,
      incidentUpdates: { orderBy: { createdAt: "desc" }, take: 1, select: { message: true, createdAt: true } },
      childTickets: { where: { requesterId: actor.id, deletedAt: null }, select: { number: true }, take: 1 },
    },
  });
  return rows.map((r) => ({
    id: r.id, subject: r.subject, status: r.majorIncidentStatus!, declaredAt: r.majorDeclaredAt, impact: r.impactScope,
    latest: r.incidentUpdates[0] ?? null, myTicket: r.childTickets[0]?.number ?? null,
  }));
}

/** Employee reports being affected: creates a linked child ticket (same category) for the incident. */
export async function reportAffected(actor: Actor, incidentId: string, raw: unknown) {
  const details = z.object({ details: z.string().trim().max(5000).default("") }).parse(raw ?? {}).details;
  const relevant = (await activeIncidentsFor(actor)).find((i) => i.id === incidentId);
  if (!relevant) throw new NotFoundError("This incident does not affect your branch or company.");
  if (relevant.myTicket) throw new ValidationError(`You already reported this issue (${relevant.myTicket}).`);
  const parent = await prisma.ticket.findUniqueOrThrow({ where: { id: incidentId }, select: { id: true, number: true, subject: true, categoryId: true, subcategoryId: true } });
  const created = await createTicket(actor, {
    subject: `Affected by: ${parent.subject}`.slice(0, 200),
    description: details.length >= 10 ? details : `I am affected by the ongoing incident "${parent.subject}".${details ? `\n\n${details}` : ""}`,
    categoryId: parent.categoryId, subcategoryId: parent.subcategoryId ?? undefined,
  });
  await transaction(async (tx) => {
    await tx.ticket.update({ where: { id: created.id }, data: { parentIncidentId: parent.id } });
    await tx.ticketHistory.create({ data: { ticketId: created.id, actorId: actor.id, action: "LINKED_TO_INCIDENT", newValue: parent.number, reason: "Reported via known-issue banner" } });
    await tx.ticketHistory.create({ data: { ticketId: parent.id, actorId: actor.id, action: "INCIDENT_LINKED", newValue: created.number } });
    await audit(tx, actor, { action: "INCIDENT_LINKED", entityType: "Ticket", entityId: parent.id, ticketId: parent.id, newValue: { child: created.number, selfReported: true } });
  });
  return created;
}
