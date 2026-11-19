import { z } from "zod";
import { prisma } from "@/server/db";
import { transaction } from "@/server/db-tx";
import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { can } from "@/server/authz/guards";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { canAssignTicket, canWorkTicket } from "@/server/authz/scope";
import { CONFIGURABLE_REQUIRED_FIELDS, type RequiredFieldKey } from "@/lib/validation/ticket";
import { audit } from "./audit";
import { notifyUsers, teamMemberIds } from "./notifications";
import { computeSlaTargets } from "./sla";
import { loadTicketForMutation } from "./tickets";

const optText = (max: number) =>
  z.preprocess((v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v), z.string().trim().max(max).nullable());
const optId = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().min(1).max(50).nullable());

export const updateTicketSchema = z.object({
  subject: z.string().trim().min(5, "Subject must be at least 5 characters").max(200),
  description: z.string().trim().min(10).max(20000),
  categoryId: z.string().min(1),
  subcategoryId: optId,
  priorityId: z.string().min(1),
  branchId: optId,
  locationId: optId,
  contactNumber: optText(50),
  relatedAsset: optText(100),
  affectedSystem: optText(200),
  affectedUsers: optText(500),
  isConfidential: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  reason: optText(1000).optional(),
});

function assertEditable(actor: Actor, kind: string) {
  if ((kind === "CLOSED" || kind === "CANCELLED") && !can(actor, P.TICKET_CLOSED_EDIT)) {
    throw new ValidationError("Closed tickets cannot be edited. Reopen the ticket first.");
  }
}

/**
 * Support staff edit ticket information after creation. Each changed field is
 * written to the ticket history; category/priority changes get dedicated audit
 * actions and trigger SLA due-date recalculation (from the original creation time).
 */
export async function updateTicketFields(actor: Actor, ticketId: string, raw: unknown) {
  const ticket = await loadTicketForMutation(actor, ticketId);
  if (!canWorkTicket(actor, ticket) || isVendor(actor)) throw new AuthorizationError("You cannot edit this ticket.");
  assertEditable(actor, ticket.status.kind);
  const parsed = updateTicketSchema.safeParse(raw);
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    throw new ValidationError("Please correct the highlighted fields.", fe);
  }
  const input = parsed.data;

  // Category validation (same rules as creation)
  const category = await prisma.category.findFirst({
    where: { id: input.categoryId, parentId: null, deletedAt: null, OR: [{ isActive: true }, { id: ticket.categoryId }] },
    include: { children: { where: { isActive: true, deletedAt: null }, select: { id: true } } },
  });
  if (!category) throw new ValidationError("Invalid category.", { categoryId: "Invalid category" });
  let subcategory = null;
  if (input.subcategoryId) {
    subcategory = await prisma.category.findFirst({
      where: { id: input.subcategoryId, parentId: category.id, deletedAt: null, OR: [{ isActive: true }, { id: ticket.subcategoryId ?? "" }] },
    });
    if (!subcategory) throw new ValidationError("Invalid subcategory.", { subcategoryId: "Invalid subcategory" });
  } else if (category.children.length > 0) {
    throw new ValidationError("Subcategory is required.", { subcategoryId: "Subcategory is required" });
  }
  const required = new Set<RequiredFieldKey>([
    ...((category.requiredFields as RequiredFieldKey[]) ?? []), ...((subcategory?.requiredFields as RequiredFieldKey[]) ?? []),
  ]);
  const fe: Record<string, string> = {};
  for (const key of required) {
    if (key === "attachments" || !(key in CONFIGURABLE_REQUIRED_FIELDS)) continue;
    if (!input[key as Exclude<RequiredFieldKey, "attachments">]) fe[key] = `${CONFIGURABLE_REQUIRED_FIELDS[key]} is required for this category`;
  }
  if (Object.keys(fe).length) throw new ValidationError("Please fill in the required fields.", fe);

  const priority = await prisma.priority.findFirst({ where: { id: input.priorityId, OR: [{ isActive: true }, { id: ticket.priorityId }] } });
  if (!priority) throw new ValidationError("Invalid priority.", { priorityId: "Invalid priority" });
  if (input.locationId) {
    const loc = await prisma.location.findFirst({ where: { id: input.locationId, deletedAt: null } });
    if (!loc || (input.branchId && loc.branchId !== input.branchId)) throw new ValidationError("Invalid location.", { locationId: "Location does not belong to the branch" });
  }
  if (input.branchId && !(await prisma.branch.findFirst({ where: { id: input.branchId, deletedAt: null } }))) {
    throw new ValidationError("Invalid branch.", { branchId: "Invalid branch" });
  }

  // Names for readable history
  const ids = [ticket.categoryId, ticket.subcategoryId, category.id, subcategory?.id].filter(Boolean) as string[];
  const [cats, prios, branches, locations] = await Promise.all([
    prisma.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.priority.findMany({ where: { id: { in: [ticket.priorityId, priority.id] } }, select: { id: true, code: true, name: true } }),
    prisma.branch.findMany({ where: { id: { in: [ticket.branchId, input.branchId].filter(Boolean) as string[] } }, select: { id: true, name: true } }),
    prisma.location.findMany({ where: { id: { in: [ticket.locationId, input.locationId].filter(Boolean) as string[] } }, select: { id: true, name: true } }),
  ]);
  const nm = (list: { id: string; name: string }[], id: string | null) => (id ? list.find((x) => x.id === id)?.name ?? id : null);
  const pn = (id: string) => { const p = prios.find((x) => x.id === id); return p ? `${p.code} ${p.name}` : id; };

  type Change = { field: string; label: string; old: string | null; neu: string | null };
  const changes: Change[] = [];
  const cmp = (field: string, label: string, old: string | null, neu: string | null) => {
    if ((old ?? null) !== (neu ?? null)) changes.push({ field, label, old, neu });
  };
  cmp("subject", "Subject", ticket.subject, input.subject);
  cmp("description", "Description", ticket.description, input.description);
  const catOld = [nm(cats, ticket.categoryId), nm(cats, ticket.subcategoryId)].filter(Boolean).join(" › ");
  const catNew = [category.name, subcategory?.name].filter(Boolean).join(" › ");
  if (ticket.categoryId !== category.id || (ticket.subcategoryId ?? null) !== (subcategory?.id ?? null)) changes.push({ field: "category", label: "Category", old: catOld, neu: catNew });
  cmp("priority", "Priority", pn(ticket.priorityId), pn(priority.id));
  cmp("branch", "Branch", nm(branches, ticket.branchId), nm(branches, input.branchId));
  cmp("location", "Location", nm(locations, ticket.locationId), nm(locations, input.locationId));
  cmp("contactNumber", "Contact number", ticket.contactNumber, input.contactNumber);
  cmp("relatedAsset", "Related asset", ticket.relatedAsset, input.relatedAsset);
  cmp("affectedSystem", "Affected system", ticket.affectedSystem, input.affectedSystem);
  cmp("affectedUsers", "Affected users", ticket.affectedUsers, input.affectedUsers);
  cmp("isConfidential", "Confidential", ticket.isConfidential ? "Yes" : "No", input.isConfidential ? "Yes" : "No");
  if (changes.length === 0) throw new ValidationError("No changes to save.");

  const slaRelevant = changes.some((c) => c.field === "priority" || c.field === "category");
  const sla = slaRelevant
    ? await computeSlaTargets(prisma, {
        subcategorySlaProfileId: subcategory?.slaProfileId, categorySlaProfileId: category.slaProfileId,
        teamId: ticket.ownerTeamId, priorityId: priority.id, start: ticket.createdAt,
      })
    : null;

  await transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        subject: input.subject, description: input.description, categoryId: category.id, subcategoryId: subcategory?.id ?? null,
        priorityId: priority.id, branchId: input.branchId, locationId: input.locationId, contactNumber: input.contactNumber,
        relatedAsset: input.relatedAsset, affectedSystem: input.affectedSystem, affectedUsers: input.affectedUsers,
        isConfidential: input.isConfidential,
        ...(sla ? { slaProfileId: sla.slaProfileId, responseDueAt: sla.responseDueAt, resolutionDueAt: sla.resolutionDueAt } : {}),
      },
    });
    for (const c of changes) {
      const action = c.field === "category" ? "CATEGORY_CHANGED" : c.field === "priority" ? "PRIORITY_CHANGED" : "FIELD_UPDATED";
      await tx.ticketHistory.create({
        data: {
          ticketId: ticket.id, actorId: actor.id, action, field: c.label,
          oldValue: c.field === "description" ? null : c.old, newValue: c.field === "description" ? "(updated)" : c.neu,
          reason: input.reason ?? null,
        },
      });
    }
    const special = changes.filter((c) => c.field === "category" || c.field === "priority");
    for (const c of special) {
      await audit(tx, actor, { action: c.field === "category" ? "CATEGORY_CHANGED" : "PRIORITY_CHANGED", entityType: "Ticket", entityId: ticket.id, ticketId: ticket.id,
        oldValue: { [c.field]: c.old }, newValue: { [c.field]: c.neu, reason: input.reason } });
    }
    const rest = changes.filter((c) => c.field !== "category" && c.field !== "priority");
    if (rest.length) {
      await audit(tx, actor, { action: "TICKET_UPDATED", entityType: "Ticket", entityId: ticket.id, ticketId: ticket.id,
        oldValue: Object.fromEntries(rest.map((c) => [c.field, c.field === "description" ? "…" : c.old])),
        newValue: Object.fromEntries(rest.map((c) => [c.field, c.field === "description" ? "…" : c.neu])) });
    }
    await notifyUsers(tx, [ticket.requesterId, ticket.assignedAgentId], {
      type: "TICKET_UPDATED", title: `${ticket.number} updated`, body: changes.map((c) => c.label).join(", "),
      ticketId: ticket.id, link: `/tickets/${ticket.number}`,
    }, actor);
  });
  return { changed: changes.map((c) => c.label) };
}

// ───────────────────────────── Supporting teams ─────────────────────────────

export async function addSupportingTeam(actor: Actor, ticketId: string, teamId: string) {
  const ticket = await loadTicketForMutation(actor, ticketId);
  if (!canAssignTicket(actor, ticket)) throw new AuthorizationError("You cannot change the teams of this ticket.");
  assertEditable(actor, ticket.status.kind);
  if (teamId === ticket.ownerTeamId) throw new ValidationError("This team already owns the ticket.");
  const team = await prisma.supportTeam.findFirst({ where: { id: teamId, isActive: true, deletedAt: null } });
  if (!team) throw new ValidationError("Team not found or inactive.");
  const exists = await prisma.ticketSupportingTeam.findUnique({ where: { ticketId_teamId: { ticketId, teamId } } });
  if (exists) throw new ValidationError("This team is already supporting the ticket.");
  await transaction(async (tx) => {
    await tx.ticketSupportingTeam.create({ data: { ticketId, teamId } });
    await tx.ticketHistory.create({ data: { ticketId, actorId: actor.id, action: "SUPPORTING_TEAM_ADDED", newValue: team.name } });
    await audit(tx, actor, { action: "SUPPORTING_TEAM_ADDED", entityType: "Ticket", entityId: ticketId, ticketId, newValue: { teamId, team: team.name } });
    await notifyUsers(tx, await teamMemberIds(tx, teamId), {
      type: "TICKET_ASSIGNED", title: `${team.name} added as supporting team on ${ticket.number}`, body: ticket.subject,
      ticketId, link: `/admin/tickets/${ticket.number}`,
    }, actor);
  });
}

export async function removeSupportingTeam(actor: Actor, ticketId: string, teamId: string) {
  const ticket = await loadTicketForMutation(actor, ticketId);
  if (!canAssignTicket(actor, ticket)) throw new AuthorizationError("You cannot change the teams of this ticket.");
  assertEditable(actor, ticket.status.kind);
  const openTasks = await prisma.ticketTask.count({ where: { ticketId, teamId, status: { notIn: ["COMPLETED", "CANCELLED"] } } });
  if (openTasks > 0) throw new ValidationError(`This team still has ${openTasks} open task(s) on the ticket. Complete, cancel or reassign them first.`);
  const link = await prisma.ticketSupportingTeam.findUnique({ where: { ticketId_teamId: { ticketId, teamId } }, include: { team: true } });
  if (!link) throw new ValidationError("This team is not supporting the ticket.");
  await transaction(async (tx) => {
    await tx.ticketSupportingTeam.delete({ where: { ticketId_teamId: { ticketId, teamId } } });
    await tx.ticketHistory.create({ data: { ticketId, actorId: actor.id, action: "SUPPORTING_TEAM_REMOVED", oldValue: link.team.name } });
    await audit(tx, actor, { action: "SUPPORTING_TEAM_REMOVED", entityType: "Ticket", entityId: ticketId, ticketId, oldValue: { teamId, team: link.team.name } });
  });
}

// ───────────────────────────── Escalation ─────────────────────────────

export const escalateSchema = z.object({
  teamId: optId.optional(),
  priorityId: optId.optional(),
  reason: z.string().trim().min(5, "Please give a reason (min. 5 characters)").max(1000),
});

/**
 * Manual escalation: optionally raise priority and/or move to another team,
 * always notifying the target team's leads. Recorded as an ESCALATE assignment.
 */
export async function escalateTicket(actor: Actor, ticketId: string, raw: unknown) {
  const ticket = await loadTicketForMutation(actor, ticketId);
  if (!can(actor, P.TICKET_ESCALATE) || isVendor(actor) || !canWorkTicket(actor, ticket)) {
    throw new AuthorizationError("You do not have permission to escalate this ticket.");
  }
  assertEditable(actor, ticket.status.kind);
  const parsed = escalateSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
  const input = parsed.data;
  const teamId = input.teamId || ticket.ownerTeamId;
  if (!teamId) throw new ValidationError("A team is required.");
  const team = await prisma.supportTeam.findFirst({ where: { id: teamId, isActive: true, deletedAt: null } });
  if (!team) throw new ValidationError("Team not found or inactive.");
  const teamChanged = teamId !== ticket.ownerTeamId;
  let newPriority = null;
  if (input.priorityId && input.priorityId !== ticket.priorityId) {
    newPriority = await prisma.priority.findFirst({ where: { id: input.priorityId, isActive: true } });
    if (!newPriority) throw new ValidationError("Invalid priority.");
  }
  const oldPriority = await prisma.priority.findUniqueOrThrow({ where: { id: ticket.priorityId } });
  if (newPriority && newPriority.level > oldPriority.level) throw new ValidationError("Escalation can only raise the priority.");
  const sla = newPriority
    ? await computeSlaTargets(prisma, { categorySlaProfileId: ticket.slaProfileId, teamId, priorityId: newPriority.id, start: ticket.createdAt })
    : null;

  await transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        ...(teamChanged ? { ownerTeamId: teamId, assignedAgentId: null } : {}),
        ...(newPriority ? { priorityId: newPriority.id } : {}),
        ...(sla?.resolutionDueAt ? { responseDueAt: sla.responseDueAt, resolutionDueAt: sla.resolutionDueAt } : {}),
      },
    });
    await tx.ticketAssignment.create({
      data: { ticketId: ticket.id, type: "ESCALATE", prevTeamId: ticket.ownerTeamId, newTeamId: teamId, prevAgentId: ticket.assignedAgentId,
        newAgentId: teamChanged ? null : ticket.assignedAgentId, changedById: actor.id, reason: input.reason },
    });
    await tx.ticketHistory.create({
      data: { ticketId: ticket.id, actorId: actor.id, action: "ESCALATED", field: "escalation",
        newValue: [teamChanged ? `→ ${team.name}` : null, newPriority ? `priority ${oldPriority.code} → ${newPriority.code}` : null].filter(Boolean).join(", ") || team.name,
        reason: input.reason },
    });
    if (newPriority) {
      await tx.ticketHistory.create({ data: { ticketId: ticket.id, actorId: actor.id, action: "PRIORITY_CHANGED", field: "Priority",
        oldValue: `${oldPriority.code} ${oldPriority.name}`, newValue: `${newPriority.code} ${newPriority.name}`, reason: "Escalation" } });
    }
    await audit(tx, actor, {
      action: "TICKET_ESCALATED", entityType: "Ticket", entityId: ticket.id, ticketId: ticket.id,
      oldValue: { ownerTeamId: ticket.ownerTeamId, priority: oldPriority.code },
      newValue: { ownerTeamId: teamId, priority: newPriority?.code ?? oldPriority.code, reason: input.reason },
    });
    const leads = await teamMemberIds(tx, teamId, true);
    await notifyUsers(tx, [...leads, ticket.assignedAgentId], {
      type: "TICKET_ESCALATED", title: `Escalated: ${ticket.number}`, body: input.reason, ticketId: ticket.id, link: `/admin/tickets/${ticket.number}`,
    }, actor);
  });
}

/** Options for the edit dialog. */
export async function getTicketEditOptions() {
  const [categories, priorities, branches, teams] = await Promise.all([
    prisma.category.findMany({
      where: { parentId: null, isActive: true, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, children: { where: { isActive: true, deletedAt: null }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
    }),
    prisma.priority.findMany({ where: { isActive: true }, orderBy: { level: "asc" }, select: { id: true, code: true, name: true, level: true } }),
    prisma.branch.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { name: "asc" },
      select: { id: true, name: true, locations: { where: { isActive: true, deletedAt: null }, select: { id: true, name: true } } } }),
    prisma.supportTeam.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
  ]);
  return { categories, priorities, branches, teams };
}
