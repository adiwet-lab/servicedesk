import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { transaction } from "@/server/db-tx";
import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { requirePermission } from "@/server/authz/guards";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { nextAfterApproval, resolveApprovalChain, type StepDef } from "@/server/domain/approvals";
import { audit } from "./audit";
import { notifyUsers, teamMemberIds } from "./notifications";
import { applyStatusChange, pauseForApproval, resumeAfterApproval, ticketSlaSelect } from "./sla";

type Tx = Prisma.TransactionClient;

// ───────────────────────────── Policy matching (ticket creation) ─────────────────────────────

/** Subcategory policy wins over the main-category policy. Inactive policies are ignored. */
export async function findPolicy(db: Tx | typeof prisma, categoryId: string, subcategoryId: string | null) {
  const ids = [subcategoryId, categoryId].filter((x): x is string => !!x);
  const rows = await db.approvalPolicy.findMany({ where: { categoryId: { in: ids }, isActive: true }, include: { steps: { orderBy: { order: "asc" } } } });
  return rows.find((r) => r.categoryId === subcategoryId) ?? rows.find((r) => r.categoryId === categoryId) ?? null;
}

/** Resolves approvers for a new ticket. Throws ValidationError when the chain cannot be built. */
export async function planApprovals(db: Tx | typeof prisma, categoryId: string, subcategoryId: string | null, requester: { id: string; managerId: string | null }) {
  const policy = await findPolicy(db, categoryId, subcategoryId);
  if (!policy) return null;
  const ids = [requester.managerId, ...policy.steps.flatMap((s) => [s.approverUserId, s.fallbackUserId])].filter((x): x is string => !!x);
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, deletedAt: true, accessExpiresAt: true, tenant: { select: { type: true, isActive: true } } } });
  const now = new Date();
  const map = new Map(users.map((u) => [u.id, {
    id: u.id,
    active: u.status === "ACTIVE" && !u.deletedAt && (!u.accessExpiresAt || u.accessExpiresAt > now) && u.tenant.isActive && u.tenant.type !== "VENDOR",
  }]));
  const r = resolveApprovalChain(policy.steps as StepDef[], requester, map);
  if (!r.ok) throw new ValidationError(r.error);
  return { policy, steps: r.steps };
}

/** Called inside the ticket-creation transaction. Snapshots the chain, pauses SLA, notifies the first approver. */
export async function startApprovals(
  tx: Tx, actor: Actor, ticket: { id: string; number: string; subject: string },
  plan: NonNullable<Awaited<ReturnType<typeof planApprovals>>>, now = new Date(),
) {
  await tx.ticketApproval.createMany({
    data: plan.steps.map((s, i) => ({ ticketId: ticket.id, stepOrder: s.order, stepName: s.name, approverId: s.approverId, decision: i === 0 ? "PENDING" as const : "WAITING" as const })),
  });
  const t = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id }, select: ticketSlaSelect });
  const sla = await pauseForApproval(tx, t, now);
  await tx.ticket.update({ where: { id: ticket.id }, data: { approvalStatus: "PENDING", approvalPolicyId: plan.policy.id, ...sla } });
  await tx.ticketHistory.create({ data: { ticketId: ticket.id, actorId: actor.id, action: "APPROVAL_REQUESTED", newValue: plan.policy.name, reason: plan.steps.map((s) => s.name).join(" → ") } });
  await audit(tx, actor, { action: "APPROVAL_REQUESTED", entityType: "Ticket", entityId: ticket.id, ticketId: ticket.id,
    newValue: { policy: plan.policy.name, steps: plan.steps.map((s) => ({ order: s.order, approverId: s.approverId, viaFallback: s.viaFallback })) } });
  await notifyUsers(tx, [plan.steps[0]!.approverId], {
    type: "APPROVAL_REQUESTED", title: `Approval needed: ${ticket.number}`, body: `${ticket.subject} — ${plan.steps[0]!.name}`, ticketId: ticket.id, link: "/approvals",
  }, actor);
}

// ───────────────────────────── Decisions ─────────────────────────────

export const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(2000).optional()),
}).refine((d) => d.decision === "APPROVED" || !!d.comment, { message: "A comment is required when rejecting.", path: ["comment"] });

/**
 * Records the current approver's decision. Only the approver of the PENDING step may decide.
 * Approve → next step (notify) or APPROVED (resume SLA, notify owner team + requester).
 * Reject → REJECTED; the ticket moves to a cancelled-kind status when the workflow allows it.
 */
export async function decideApproval(actor: Actor, approvalId: string, raw: unknown) {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid decision", { comment: parsed.error.issues[0]?.message ?? "" });
  const { decision, comment } = parsed.data;
  const row = await prisma.ticketApproval.findUnique({ where: { id: approvalId } });
  if (!row || row.approverId !== actor.id) throw new NotFoundError("Approval not found.");
  if (isVendor(actor)) throw new AuthorizationError();
  if (row.decision !== "PENDING") throw new ValidationError("This approval has already been decided or is not yet due.");
  const now = new Date();

  return transaction(async (tx) => {
    // Optimistic guard against double-submission / concurrent decisions.
    const moved = await tx.ticketApproval.updateMany({ where: { id: row.id, decision: "PENDING" }, data: { decision, comment: comment ?? null, decidedAt: now } });
    if (moved.count !== 1) throw new ValidationError("This approval has already been decided.");
    const t = await tx.ticket.findUniqueOrThrow({
      where: { id: row.ticketId },
      select: { ...ticketSlaSelect, number: true, subject: true, requesterId: true, ownerTeamId: true, assignedAgentId: true, statusId: true,
        status: { select: { code: true, kind: true, pausesSla: true, name: true } }, approvals: { select: { stepOrder: true, decision: true, approverId: true, stepName: true } } },
    });
    await tx.ticketHistory.create({ data: { ticketId: t.id, actorId: actor.id, action: decision === "APPROVED" ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED", field: row.stepName, newValue: decision === "APPROVED" ? "Approved" : "Rejected", reason: comment ?? null } });
    await audit(tx, actor, { action: `APPROVAL_${decision}`, entityType: "Ticket", entityId: t.id, ticketId: t.id, newValue: { step: row.stepOrder, comment: comment ?? null } });
    const staff = [...(await teamMemberIds(tx, t.ownerTeamId)), t.assignedAgentId];

    if (decision === "REJECTED") {
      await tx.ticketApproval.updateMany({ where: { ticketId: t.id, decision: "WAITING" }, data: { decision: "CANCELLED" } });
      let data: Prisma.TicketUncheckedUpdateInput = { approvalStatus: "REJECTED" };
      const tr = await tx.workflowTransition.findFirst({ where: { fromStatusId: t.statusId, toStatus: { kind: "CANCELLED", isActive: true } }, include: { toStatus: true } });
      if (tr) {
        data = { ...data, statusId: tr.toStatusId, closedAt: now, ...(await applyStatusChange(tx, t, tr.toStatus, now)) };
        await tx.ticketHistory.create({ data: { ticketId: t.id, actorId: actor.id, action: "STATUS_CHANGED", field: "status", oldValue: t.status.name, newValue: tr.toStatus.name, reason: `Approval rejected: ${comment}` } });
      }
      await tx.ticket.update({ where: { id: t.id }, data });
      await notifyUsers(tx, [t.requesterId, ...staff], { type: "APPROVAL_DECIDED", title: `${t.number} was not approved`, body: `${row.stepName}: ${comment}`, ticketId: t.id, link: `/tickets/${t.number}` }, actor);
      return { status: "REJECTED" as const };
    }

    const next = nextAfterApproval(t.approvals, row.stepOrder);
    if (!next.done) {
      const n = t.approvals.find((a) => a.stepOrder === next.nextOrder)!;
      await tx.ticketApproval.update({ where: { ticketId_stepOrder: { ticketId: t.id, stepOrder: n.stepOrder } }, data: { decision: "PENDING" } });
      await notifyUsers(tx, [n.approverId], { type: "APPROVAL_REQUESTED", title: `Approval needed: ${t.number}`, body: `${t.subject} — ${n.stepName}`, ticketId: t.id, link: "/approvals" }, actor);
      return { status: "PENDING" as const };
    }
    const sla = await resumeAfterApproval(tx, t, t.status, now);
    await tx.ticket.update({ where: { id: t.id }, data: { approvalStatus: "APPROVED", ...sla } });
    await notifyUsers(tx, [t.requesterId, ...staff], { type: "APPROVAL_DECIDED", title: `${t.number} approved`, body: t.subject, ticketId: t.id, link: `/tickets/${t.number}` }, actor);
    return { status: "APPROVED" as const };
  });
}

// ───────────────────────────── Read models ─────────────────────────────

export async function myApprovals(actor: Actor) {
  const select = {
    id: true, stepName: true, stepOrder: true, decision: true, comment: true, decidedAt: true, createdAt: true,
    ticket: { select: { id: true, number: true, subject: true, description: true, createdAt: true, approvalStatus: true,
      requester: { select: { displayName: true, jobTitle: true, department: { select: { name: true } } } },
      category: { select: { name: true } }, subcategory: { select: { name: true } }, priority: { select: { code: true, color: true } } } },
  } satisfies Prisma.TicketApprovalSelect;
  const [pending, decided] = await Promise.all([
    prisma.ticketApproval.findMany({ where: { approverId: actor.id, decision: "PENDING", ticket: { deletedAt: null } }, orderBy: { createdAt: "asc" }, select }),
    prisma.ticketApproval.findMany({ where: { approverId: actor.id, decision: { in: ["APPROVED", "REJECTED"] } }, orderBy: { decidedAt: "desc" }, take: 50, select }),
  ]);
  return { pending, decided };
}

export async function pendingApprovalCount(actorId: string) {
  return prisma.ticketApproval.count({ where: { approverId: actorId, decision: "PENDING", ticket: { deletedAt: null } } });
}

/** Approval chain for the ticket page (caller has already passed the ticket scope check). */
export async function ticketApprovals(actor: Actor, ticketId: string) {
  const rows = await prisma.ticketApproval.findMany({
    where: { ticketId }, orderBy: { stepOrder: "asc" },
    select: { id: true, stepOrder: true, stepName: true, decision: true, comment: true, decidedAt: true, approverId: true, approver: { select: { displayName: true } } },
  });
  return rows.map((r) => ({ ...r, canDecide: r.approverId === actor.id && r.decision === "PENDING" }));
}

// ───────────────────────────── Policy administration ─────────────────────────────

const optId = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().min(1).max(50).nullable());
export const policySchema = z.object({
  name: z.string().trim().min(3).max(120),
  categoryId: z.string().min(1, "Category is required"),
  isActive: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()).default(false),
  steps: z.array(z.object({
    name: z.string().trim().min(2).max(120),
    approverType: z.enum(["REQUESTER_MANAGER", "SPECIFIC_USER"]),
    approverUserId: optId,
    fallbackUserId: optId,
  })).min(1, "Add at least one step").max(5, "At most 5 steps"),
}).superRefine((p, ctx) => {
  p.steps.forEach((s, i) => {
    if (s.approverType === "SPECIFIC_USER" && !s.approverUserId) ctx.addIssue({ code: "custom", message: `Step ${i + 1}: choose the approver`, path: ["steps"] });
  });
});

/** Parses the flat form (steps.N.field) used by the admin page. */
export function policyFromForm(o: Record<string, unknown>) {
  const steps: Record<string, unknown>[] = [];
  for (const [k, v] of Object.entries(o)) {
    const m = /^steps\.(\d)\.(name|approverType|approverUserId|fallbackUserId)$/.exec(k);
    if (!m) continue;
    (steps[Number(m[1])] ??= {})[m[2]!] = v;
  }
  return { ...o, steps: steps.filter((s) => s && typeof s.name === "string" && s.name.trim()) };
}

export async function listPolicies(actor: Actor) {
  requirePermission(actor, P.ADMIN_WORKFLOW);
  return prisma.approvalPolicy.findMany({
    orderBy: { name: "asc" },
    include: { category: { select: { name: true, parent: { select: { name: true } } } },
      steps: { orderBy: { order: "asc" }, include: { approverUser: { select: { displayName: true } }, fallbackUser: { select: { displayName: true } } } },
      _count: { select: { tickets: true } } },
  });
}

export async function savePolicy(actor: Actor, id: string | null, raw: unknown) {
  requirePermission(actor, P.ADMIN_WORKFLOW);
  const p = policySchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Invalid policy");
  const input = p.data;
  if (!(await prisma.category.findFirst({ where: { id: input.categoryId, deletedAt: null } }))) throw new ValidationError("Invalid category.");
  const userIds = input.steps.flatMap((s) => [s.approverUserId, s.fallbackUserId]).filter((x): x is string => !!x);
  if (userIds.length) {
    const ok = await prisma.user.count({ where: { id: { in: userIds }, status: "ACTIVE", deletedAt: null, tenant: { type: { not: "VENDOR" } } } });
    if (ok !== new Set(userIds).size) throw new ValidationError("Approvers must be active internal users.");
  }
  const clash = await prisma.approvalPolicy.findFirst({ where: { categoryId: input.categoryId, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw new ValidationError(`The category already has the policy "${clash.name}".`);
  return transaction(async (tx) => {
    const before = id ? await tx.approvalPolicy.findUnique({ where: { id }, include: { steps: true } }) : null;
    if (id && !before) throw new NotFoundError();
    const policy = id
      ? await tx.approvalPolicy.update({ where: { id }, data: { name: input.name, categoryId: input.categoryId, isActive: input.isActive } })
      : await tx.approvalPolicy.create({ data: { name: input.name, categoryId: input.categoryId, isActive: input.isActive } });
    await tx.approvalStep.deleteMany({ where: { policyId: policy.id } });
    await tx.approvalStep.createMany({ data: input.steps.map((s, i) => ({ policyId: policy.id, order: i + 1, ...s })) });
    await audit(tx, actor, { action: id ? "APPROVAL_POLICY_UPDATED" : "APPROVAL_POLICY_CREATED", entityType: "ApprovalPolicy", entityId: policy.id,
      oldValue: before ? { name: before.name, categoryId: before.categoryId, isActive: before.isActive, steps: before.steps.length } : undefined,
      newValue: { name: input.name, categoryId: input.categoryId, isActive: input.isActive, steps: input.steps } });
    return policy;
  });
}

export async function deletePolicy(actor: Actor, id: string) {
  requirePermission(actor, P.ADMIN_WORKFLOW);
  const p = await prisma.approvalPolicy.findUnique({ where: { id }, include: { _count: { select: { tickets: true } } } });
  if (!p) throw new NotFoundError();
  if (p._count.tickets > 0) throw new ValidationError("The policy is used by tickets — deactivate it instead.");
  await transaction(async (tx) => {
    await tx.approvalPolicy.delete({ where: { id } });
    await audit(tx, actor, { action: "APPROVAL_POLICY_DELETED", entityType: "ApprovalPolicy", entityId: id, oldValue: { name: p.name } });
  });
}
