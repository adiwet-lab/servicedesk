import { initialScanStatus } from "@/server/storage/malware-scan";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { transaction } from "@/server/db-tx";
import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { can } from "@/server/authz/guards";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import {
  canAssignTask, canManageTicketTasks, canReopenTask, canWorkTask, taskScopeWhere, ticketScopeWhere,
} from "@/server/authz/scope";
import {
  TASK_STATUS_LABEL, TASK_TERMINAL, allowedTaskTransitions, ticketTaskProgress, validateTaskTransition,
} from "@/server/domain/task-workflow";
import { enforceRateLimit } from "@/server/ratelimit";
import { getStorage } from "@/server/storage/provider";
import { validateUploads, type UploadCandidate } from "@/server/storage/validate";
import { audit } from "./audit";
import { nextNumber } from "./numbering";
import { notifyUsers, teamMemberIds } from "./notifications";
import { getSettings } from "./settings";

type Tx = Prisma.TransactionClient;

// ───────────────────────────── Validation ─────────────────────────────

const optText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable().optional());
const optId = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().min(1).max(50).nullable());
const optDate = z.preprocess((v) => (v === "" || v == null ? null : new Date(String(v))), z.date().nullable())
  .refine((d) => d === null || !Number.isNaN(d.getTime()), "Invalid date");
const bool = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());

export const createTaskSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(200),
  description: optText(10000),
  teamId: z.string().min(1, "Team is required"),
  agentId: optId.optional(),
  priorityId: optId.optional(),
  startDate: optDate.optional(),
  dueDate: optDate.optional(),
  isRequired: bool.default(true),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: optText(10000),
  priorityId: optId,
  startDate: optDate,
  dueDate: optDate,
  isRequired: bool,
});

function fieldErrorsOf(err: z.ZodError) {
  const fe: Record<string, string> = {};
  for (const i of err.issues) fe[String(i.path[0])] ??= i.message;
  return fe;
}

// ───────────────────────────── Loading helpers ─────────────────────────────

const ticketForTask = {
  select: { id: true, number: true, subject: true, ownerTeamId: true, assignedAgentId: true, requesterId: true, status: { select: { kind: true } } },
} as const;

async function loadTask(actor: Actor, taskId: string) {
  const task = await prisma.ticketTask.findFirst({
    where: { AND: [taskScopeWhere(actor), { OR: [{ id: taskId }, { number: taskId }] }] },
    include: { ticket: ticketForTask, team: { select: { id: true, name: true } }, assignedAgent: { select: { id: true, displayName: true } } },
  });
  if (!task) throw new NotFoundError("Task not found or you do not have access.");
  return task;
}

function assertTicketOpen(actor: Actor, kind: string) {
  if ((kind === "CLOSED" || kind === "CANCELLED") && !can(actor, P.TICKET_CLOSED_EDIT)) {
    throw new ValidationError("Tasks of closed tickets cannot be modified.");
  }
}

async function assertTeamAndAgent(tx: Tx | typeof prisma, teamId: string, agentId: string | null | undefined) {
  const team = await tx.supportTeam.findFirst({ where: { id: teamId, isActive: true, deletedAt: null } });
  if (!team) throw new ValidationError("Team not found or inactive.", { teamId: "Team not found or inactive" });
  if (agentId) {
    const m = await tx.teamMember.findFirst({ where: { teamId, userId: agentId, user: { status: "ACTIVE", deletedAt: null } } });
    if (!m) throw new ValidationError("The selected agent is not an active member of the team.", { agentId: "Not an active member of the team" });
  }
  return team;
}

/** Adds team as a supporting team when it is not the ticket's owner team. */
async function ensureSupportingTeam(tx: Tx, actor: Actor, ticket: { id: string; ownerTeamId: string | null }, teamId: string, teamName: string) {
  if (teamId === ticket.ownerTeamId) return;
  const existing = await tx.ticketSupportingTeam.findUnique({ where: { ticketId_teamId: { ticketId: ticket.id, teamId } } });
  if (existing) return;
  await tx.ticketSupportingTeam.create({ data: { ticketId: ticket.id, teamId } });
  await tx.ticketHistory.create({ data: { ticketId: ticket.id, actorId: actor.id, action: "SUPPORTING_TEAM_ADDED", newValue: teamName, reason: "Added via task" } });
}

const taskLink = (ticketNumber: string, taskNumber: string) => `/admin/tickets/${ticketNumber}?task=${taskNumber}`;

// ───────────────────────────── Create ─────────────────────────────

export async function createTask(actor: Actor, ticketId: string, raw: unknown) {
  await enforceRateLimit(`task:create:${actor.id}`, 100, 60 * 60 * 1000);
  const ticket = await prisma.ticket.findFirst({ where: { AND: [ticketScopeWhere(actor), { id: ticketId }] }, ...ticketForTask });
  if (!ticket) throw new NotFoundError("Ticket not found or you do not have access.");
  if (!canManageTicketTasks(actor, ticket)) throw new AuthorizationError("You cannot create tasks on this ticket.");
  assertTicketOpen(actor, ticket.status.kind);

  const parsed = createTaskSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", fieldErrorsOf(parsed.error));
  const input = parsed.data;
  if (input.dueDate && input.startDate && input.dueDate < input.startDate) {
    throw new ValidationError("Due date must be after the start date.", { dueDate: "Must be after the start date" });
  }
  const team = await assertTeamAndAgent(prisma, input.teamId, input.agentId);
  // Assigning someone other than yourself requires task.assign.
  if (input.agentId && input.agentId !== actor.id && !can(actor, P.TASK_ASSIGN)) {
    throw new AuthorizationError("You do not have permission to assign tasks to other agents.");
  }
  if (input.priorityId && !(await prisma.priority.findFirst({ where: { id: input.priorityId, isActive: true } }))) {
    throw new ValidationError("Invalid priority.", { priorityId: "Invalid priority" });
  }

  return transaction(async (tx) => {
    const number = await nextNumber(tx, "TASK");
    const status: TaskStatus = input.agentId ? "ASSIGNED" : "OPEN";
    const task = await tx.ticketTask.create({
      data: {
        number, ticketId: ticket.id, title: input.title, description: input.description ?? null, teamId: team.id,
        assignedAgentId: input.agentId ?? null, priorityId: input.priorityId ?? null, status, isRequired: input.isRequired,
        startDate: input.startDate ?? null, dueDate: input.dueDate ?? null, createdById: actor.id,
      },
    });
    await tx.taskAssignment.create({ data: { taskId: task.id, teamId: team.id, agentId: input.agentId ?? null, changedById: actor.id, reason: "Created" } });
    await tx.taskHistory.create({ data: { taskId: task.id, actorId: actor.id, action: "CREATED", newValue: `${number} — ${input.title}` } });
    await tx.ticketHistory.create({
      data: { ticketId: ticket.id, actorId: actor.id, action: "TASK_CREATED", newValue: `${number} ${input.title} → ${team.name}${input.isRequired ? "" : " (optional)"}` },
    });
    await ensureSupportingTeam(tx, actor, ticket, team.id, team.name);
    await audit(tx, actor, {
      action: "TASK_CREATED", entityType: "TicketTask", entityId: task.id, ticketId: ticket.id,
      newValue: { number, title: input.title, teamId: team.id, agentId: input.agentId, isRequired: input.isRequired, dueDate: input.dueDate },
    });
    const recipients = input.agentId ? [input.agentId] : await teamMemberIds(tx, team.id);
    await notifyUsers(tx, recipients, {
      type: input.agentId ? "TASK_ASSIGNED" : "TASK_CREATED", title: `New task ${number} on ${ticket.number}`, body: input.title,
      ticketId: ticket.id, link: taskLink(ticket.number, number),
    }, actor);
    return { id: task.id, number };
  });
}

// ───────────────────────────── Update fields ─────────────────────────────

export async function updateTask(actor: Actor, taskId: string, raw: unknown) {
  const task = await loadTask(actor, taskId);
  if (!canWorkTask(actor, task, task.ticket)) throw new AuthorizationError("You cannot edit this task.");
  assertTicketOpen(actor, task.ticket.status.kind);
  if (TASK_TERMINAL.includes(task.status)) throw new ValidationError("Completed or cancelled tasks cannot be edited. Reopen it first.");
  const parsed = updateTaskSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", fieldErrorsOf(parsed.error));
  const input = parsed.data;
  if (input.dueDate && input.startDate && input.dueDate < input.startDate) {
    throw new ValidationError("Due date must be after the start date.", { dueDate: "Must be after the start date" });
  }
  // Only the owner side may change whether a task blocks resolution.
  if (input.isRequired !== task.isRequired && !canReopenTask(actor, task.ticket)) {
    throw new AuthorizationError("Only the ticket's owning team can change whether a task is required.");
  }
  const priorities = await prisma.priority.findMany({ where: { id: { in: [task.priorityId, input.priorityId].filter(Boolean) as string[] } } });
  if (input.priorityId && !priorities.some((p) => p.id === input.priorityId)) throw new ValidationError("Invalid priority.");
  const pName = (id: string | null) => (id ? priorities.find((p) => p.id === id)?.code ?? id : null);
  const fmt = (d: Date | null) => (d ? d.toISOString() : null);

  const changes: { field: string; old: string | null; neu: string | null }[] = [];
  const cmp = (field: string, old: string | null, neu: string | null) => { if ((old ?? null) !== (neu ?? null)) changes.push({ field, old, neu }); };
  cmp("title", task.title, input.title);
  cmp("description", task.description, input.description ?? null);
  cmp("priority", pName(task.priorityId), pName(input.priorityId));
  cmp("startDate", fmt(task.startDate), fmt(input.startDate));
  cmp("dueDate", fmt(task.dueDate), fmt(input.dueDate));
  cmp("required", task.isRequired ? "Required" : "Optional", input.isRequired ? "Required" : "Optional");
  if (changes.length === 0) return;

  await transaction(async (tx) => {
    await tx.ticketTask.update({
      where: { id: task.id },
      data: { title: input.title, description: input.description ?? null, priorityId: input.priorityId, startDate: input.startDate, dueDate: input.dueDate, isRequired: input.isRequired },
    });
    for (const c of changes) {
      await tx.taskHistory.create({
        data: { taskId: task.id, actorId: actor.id, action: "FIELD_UPDATED", field: c.field,
          oldValue: c.field === "description" ? null : c.old, newValue: c.field === "description" ? "(updated)" : c.neu },
      });
    }
    await audit(tx, actor, {
      action: "TASK_UPDATED", entityType: "TicketTask", entityId: task.id, ticketId: task.ticketId,
      oldValue: Object.fromEntries(changes.map((c) => [c.field, c.old])), newValue: Object.fromEntries(changes.map((c) => [c.field, c.neu])),
    });
    await notifyUsers(tx, [task.assignedAgentId], {
      type: "TASK_UPDATED", title: `${task.number} updated`, body: changes.map((c) => c.field).join(", "),
      ticketId: task.ticketId, link: taskLink(task.ticket.number, task.number),
    }, actor);
  });
}

// ───────────────────────────── Status ─────────────────────────────

export async function changeTaskStatus(actor: Actor, taskId: string, input: { status: string; reason?: string | null }) {
  const task = await loadTask(actor, taskId);
  if (!canWorkTask(actor, task, task.ticket)) throw new AuthorizationError("You cannot update this task.");
  assertTicketOpen(actor, task.ticket.status.kind);
  const to = input.status as TaskStatus;
  if (!(to in TASK_STATUS_LABEL)) throw new ValidationError("Unknown task status.");
  const err = validateTaskTransition(task.status, to, { canReopen: canReopenTask(actor, task.ticket), reason: input.reason });
  if (err) throw new ValidationError(err);

  const now = new Date();
  await transaction(async (tx) => {
    const res = await tx.ticketTask.updateMany({
      where: { id: task.id, status: task.status },
      data: {
        status: to,
        completedAt: to === "COMPLETED" ? now : to === "IN_PROGRESS" && task.status === "COMPLETED" ? null : undefined,
        startDate: to === "IN_PROGRESS" && !task.startDate ? now : undefined,
      },
    });
    if (res.count !== 1) throw new ValidationError("The task was changed by someone else. Please reload and try again.");
    await tx.taskHistory.create({
      data: { taskId: task.id, actorId: actor.id, action: "STATUS_CHANGED", field: "status",
        oldValue: TASK_STATUS_LABEL[task.status], newValue: TASK_STATUS_LABEL[to], },
    });
    if (input.reason) {
      await tx.taskHistory.create({ data: { taskId: task.id, actorId: actor.id, action: "COMMENT", newValue: input.reason.trim().slice(0, 2000) } });
    }
    await tx.ticketHistory.create({
      data: { ticketId: task.ticketId, actorId: actor.id, action: "TASK_STATUS_CHANGED", field: task.number,
        oldValue: TASK_STATUS_LABEL[task.status], newValue: TASK_STATUS_LABEL[to], reason: input.reason ?? null },
    });
    await audit(tx, actor, {
      action: "TASK_UPDATED", entityType: "TicketTask", entityId: task.id, ticketId: task.ticketId,
      oldValue: { status: task.status }, newValue: { status: to, reason: input.reason },
    });

    const link = taskLink(task.ticket.number, task.number);
    await notifyUsers(tx, [task.assignedAgentId, task.ticket.assignedAgentId], {
      type: "TASK_UPDATED", title: `${task.number}: ${TASK_STATUS_LABEL[task.status]} → ${TASK_STATUS_LABEL[to]}`, body: task.title,
      ticketId: task.ticketId, link,
    }, actor);

    if (to === "COMPLETED" && task.isRequired) {
      const siblings = await tx.ticketTask.findMany({ where: { ticketId: task.ticketId }, select: { isRequired: true, status: true } });
      const progress = ticketTaskProgress(siblings);
      if (progress.openRequired === 0) {
        const ownerLeads = task.ticket.assignedAgentId ? [task.ticket.assignedAgentId] : await teamMemberIds(tx, task.ticket.ownerTeamId, true);
        await notifyUsers(tx, ownerLeads, {
          type: "TASK_UPDATED", title: `All required tasks completed on ${task.ticket.number}`, body: "The ticket can now be resolved.",
          ticketId: task.ticketId, link: `/admin/tickets/${task.ticket.number}`,
        }, actor);
      }
    }
  });
}

// ───────────────────────────── Assign ─────────────────────────────

export async function assignTask(actor: Actor, taskId: string, input: { teamId?: string | null; agentId?: string | null; reason?: string | null }) {
  const task = await loadTask(actor, taskId);
  assertTicketOpen(actor, task.ticket.status.kind);
  if (TASK_TERMINAL.includes(task.status)) throw new ValidationError("Completed or cancelled tasks cannot be reassigned.");
  const teamId = input.teamId || task.teamId;
  if (!teamId) throw new ValidationError("A team is required.");
  const agentId = input.agentId || null;
  if (!canAssignTask(actor, task, task.ticket, { teamId, agentId })) throw new AuthorizationError("You cannot assign this task.");
  if (teamId === task.teamId && agentId === task.assignedAgentId) throw new ValidationError("Nothing to change.");
  const teamChanged = teamId !== task.teamId;
  if (teamChanged && !input.reason?.trim()) throw new ValidationError("A reason is required when moving a task to another team.");
  const team = await assertTeamAndAgent(prisma, teamId, agentId);
  const agentName = agentId ? (await prisma.user.findUnique({ where: { id: agentId }, select: { displayName: true } }))?.displayName ?? null : null;

  await transaction(async (tx) => {
    const nextStatus: TaskStatus | undefined =
      agentId && task.status === "OPEN" ? "ASSIGNED" : !agentId && task.status === "ASSIGNED" ? "OPEN" : undefined;
    await tx.ticketTask.update({ where: { id: task.id }, data: { teamId, assignedAgentId: agentId, ...(nextStatus ? { status: nextStatus } : {}) } });
    await tx.taskAssignment.create({ data: { taskId: task.id, teamId, agentId, changedById: actor.id, reason: input.reason ?? null } });
    if (teamChanged) {
      await tx.taskHistory.create({ data: { taskId: task.id, actorId: actor.id, action: "TEAM_CHANGED", field: "team", oldValue: task.team?.name ?? null, newValue: team.name } });
      await ensureSupportingTeam(tx, actor, task.ticket, team.id, team.name);
    }
    if (agentId !== task.assignedAgentId) {
      await tx.taskHistory.create({ data: { taskId: task.id, actorId: actor.id, action: "AGENT_CHANGED", field: "agent", oldValue: task.assignedAgent?.displayName ?? null, newValue: agentName ?? "Unassigned" } });
    }
    if (nextStatus) {
      await tx.taskHistory.create({ data: { taskId: task.id, actorId: actor.id, action: "STATUS_CHANGED", field: "status", oldValue: TASK_STATUS_LABEL[task.status], newValue: TASK_STATUS_LABEL[nextStatus] } });
    }
    if (input.reason) await tx.taskHistory.create({ data: { taskId: task.id, actorId: actor.id, action: "COMMENT", newValue: input.reason } });
    await tx.ticketHistory.create({
      data: { ticketId: task.ticketId, actorId: actor.id, action: "TASK_ASSIGNED", field: task.number,
        oldValue: [task.team?.name, task.assignedAgent?.displayName].filter(Boolean).join(" / ") || null,
        newValue: [team.name, agentName ?? "Unassigned"].join(" / "), reason: input.reason ?? null },
    });
    await audit(tx, actor, {
      action: "TASK_ASSIGNED", entityType: "TicketTask", entityId: task.id, ticketId: task.ticketId,
      oldValue: { teamId: task.teamId, agentId: task.assignedAgentId }, newValue: { teamId, agentId, reason: input.reason },
    });
    const link = taskLink(task.ticket.number, task.number);
    if (agentId) {
      await notifyUsers(tx, [agentId], { type: "TASK_ASSIGNED", title: `${task.number} assigned to you`, body: task.title, ticketId: task.ticketId, link }, actor);
    } else if (teamChanged) {
      await notifyUsers(tx, await teamMemberIds(tx, teamId), { type: "TASK_ASSIGNED", title: `${task.number} moved to ${team.name}`, body: task.title, ticketId: task.ticketId, link }, actor);
    }
  });
}

// ───────────────────────────── Attachments ─────────────────────────────

export async function addTaskAttachments(actor: Actor, taskId: string, files: UploadCandidate[]) {
  await enforceRateLimit(`upload:${actor.id}`, 60, 60 * 60 * 1000);
  const task = await loadTask(actor, taskId);
  if (!canWorkTask(actor, task, task.ticket)) throw new AuthorizationError();
  assertTicketOpen(actor, task.ticket.status.kind);
  if (!files.length) throw new ValidationError("Choose at least one file.");
  const settings = await getSettings(prisma);
  const v = validateUploads(files, {
    maxFileSizeMb: settings["attachments.maxFileSizeMb"], maxFiles: settings["attachments.maxFilesPerUpload"],
    allowedExtensions: settings["attachments.allowedExtensions"],
  });
  if ("error" in v) throw new ValidationError(v.error);
  const storage = await getStorage();
  const stored: { key: string; f: (typeof v.files)[number] }[] = [];
  try {
    for (const f of v.files) {
      const key = `tasks/${new Date().getFullYear()}/${randomUUID()}`;
      await storage.put(key, f.data, f.mime);
      stored.push({ key, f });
    }
    await transaction(async (tx) => {
      for (const s of stored) {
        await tx.ticketAttachment.create({
          data: { ticketId: task.ticketId, taskId: task.id, uploadedById: actor.id, fileName: s.f.safeName, mimeType: s.f.mime, sizeBytes: s.f.size,
            sha256: createHash("sha256").update(s.f.data).digest("hex"), storageKey: s.key, scanStatus: await initialScanStatus(tx) },
        });
      }
      await tx.taskHistory.create({ data: { taskId: task.id, actorId: actor.id, action: "ATTACHMENT_ADDED", newValue: stored.map((s) => s.f.safeName).join(", ") } });
      await audit(tx, actor, { action: "ATTACHMENT_ADDED", entityType: "TicketTask", entityId: task.id, ticketId: task.ticketId, newValue: stored.map((s) => s.f.safeName) });
    });
  } catch (e) {
    await Promise.allSettled(stored.map((s) => storage.delete(s.key)));
    throw e;
  }
}

export async function removeTaskAttachment(actor: Actor, attachmentId: string) {
  const att = await prisma.ticketAttachment.findFirst({ where: { id: attachmentId, deletedAt: null, taskId: { not: null } } });
  if (!att || !att.taskId) throw new NotFoundError();
  const task = await loadTask(actor, att.taskId);
  if (!(att.uploadedById === actor.id || canWorkTask(actor, task, task.ticket))) throw new AuthorizationError();
  assertTicketOpen(actor, task.ticket.status.kind);
  await transaction(async (tx) => {
    await tx.ticketAttachment.update({ where: { id: att.id }, data: { deletedAt: new Date() } });
    await tx.taskHistory.create({ data: { taskId: task.id, actorId: actor.id, action: "ATTACHMENT_REMOVED", oldValue: att.fileName } });
    await audit(tx, actor, { action: "ATTACHMENT_REMOVED", entityType: "TicketAttachment", entityId: att.id, ticketId: task.ticketId, oldValue: { fileName: att.fileName, task: task.number } });
  });
}

// ───────────────────────────── Read ─────────────────────────────

export const taskRowInclude = {
  ticket: { select: { id: true, number: true, subject: true, ownerTeamId: true, assignedAgentId: true, status: { select: { kind: true, name: true, color: true } } } },
  team: { select: { id: true, name: true } },
  assignedAgent: { select: { id: true, displayName: true } },
  priority: { select: { id: true, code: true, name: true, color: true } },
} satisfies Prisma.TicketTaskInclude;
export type TaskRow = Prisma.TicketTaskGetPayload<{ include: typeof taskRowInclude }>;

/** Tasks of one ticket visible to the actor, with per-task capability flags. */
export async function getTicketTasks(actor: Actor, ticket: { id: string; ownerTeamId: string | null; assignedAgentId: string | null; requesterId: string; status: { kind: string } }) {
  const tasks = await prisma.ticketTask.findMany({
    where: { AND: [taskScopeWhere(actor), { ticketId: ticket.id }] },
    include: {
      ...taskRowInclude,
      history: { include: { actor: { select: { displayName: true } } }, orderBy: { createdAt: "desc" }, take: 100 },
      assignments: { include: { team: { select: { name: true } }, agent: { select: { displayName: true } }, changedBy: { select: { displayName: true } } }, orderBy: { createdAt: "desc" } },
      attachments: { where: { deletedAt: null }, include: { uploadedBy: { select: { displayName: true } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ createdAt: "asc" }],
  });
  // Progress is computed over ALL tasks (so vendors still see an honest blocker count), without exposing details.
  const all = await prisma.ticketTask.findMany({ where: { ticketId: ticket.id }, select: { isRequired: true, status: true } });
  const frozen = ["CLOSED", "CANCELLED"].includes(ticket.status.kind) && !can(actor, P.TICKET_CLOSED_EDIT);
  const canReopen = canReopenTask(actor, ticket);
  return {
    progress: ticketTaskProgress(all),
    hiddenCount: all.length - tasks.length,
    tasks: tasks.map((t) => {
      const canWork = !frozen && canWorkTask(actor, t, ticket);
      return {
        ...t,
        perm: {
          canWork: canWork && !TASK_TERMINAL.includes(t.status),
          canChangeStatus: canWork,
          canAssign: !frozen && !TASK_TERMINAL.includes(t.status) && canAssignTask(actor, t, ticket, { teamId: t.teamId, agentId: actor.id }),
          canAssignOthers: !frozen && can(actor, P.TASK_ASSIGN) && !isVendor(actor) && canAssignTask(actor, t, ticket, { teamId: null, agentId: null }),
          canSetRequired: canReopen,
          isMine: t.assignedAgentId === actor.id,
          transitions: canWork ? allowedTaskTransitions(t.status, { canReopen }) : [],
        },
      };
    }),
  };
}

export type TicketTaskWithPerm = Awaited<ReturnType<typeof getTicketTasks>>["tasks"][number];

// ───────────────────────────── Task lists ─────────────────────────────

export const TASK_VIEWS = ["my", "team", "all", "overdue"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export function availableTaskViews(actor: Actor): Set<TaskView> {
  const v = new Set<TaskView>();
  if (!can(actor, P.TASK_READ)) return v;
  v.add("my").add("overdue");
  if (actor.teamIds.length > 0 || can(actor, P.TICKET_READ_ALL)) v.add("team");
  if (can(actor, P.TICKET_READ_ALL) && !isVendor(actor)) v.add("all");
  return v;
}

export const taskListQuerySchema = z.object({
  q: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(200).optional()),
  status: z.enum(["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING", "COMPLETED", "CANCELLED", "ACTIVE"]).optional().catch(undefined),
  team: z.string().max(50).optional().catch(undefined),
  priority: z.string().max(50).optional().catch(undefined),
  required: z.enum(["yes", "no"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10000).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).catch(25),
  sort: z.enum(["number", "title", "dueDate", "createdAt", "status"]).catch("dueDate"),
  dir: z.enum(["asc", "desc"]).catch("asc"),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export async function listTasks(actor: Actor, view: TaskView, q: TaskListQuery) {
  if (!availableTaskViews(actor).has(view)) throw new AuthorizationError();
  const now = new Date();
  const active = { status: { notIn: TASK_TERMINAL } };
  const viewWhere: Prisma.TicketTaskWhereInput =
    view === "my" ? { assignedAgentId: actor.id }
    : view === "team" ? (can(actor, P.TICKET_READ_ALL) && actor.teamIds.length === 0 ? {} : { teamId: { in: actor.teamIds } })
    : view === "overdue" ? { dueDate: { lt: now }, ...active }
    : {};
  const filters: Prisma.TicketTaskWhereInput[] = [taskScopeWhere(actor), viewWhere];
  if (q.status === "ACTIVE") filters.push(active);
  else if (q.status) filters.push({ status: q.status });
  if (q.team) filters.push({ teamId: q.team });
  if (q.priority) filters.push({ priorityId: q.priority });
  if (q.required) filters.push({ isRequired: q.required === "yes" });
  if (q.q) {
    const ci = { contains: q.q, mode: "insensitive" as const };
    filters.push({ OR: [{ number: ci }, { title: ci }, { ticket: { number: ci } }, { ticket: { subject: ci } }] });
  }
  const where: Prisma.TicketTaskWhereInput = { AND: filters };
  const orderBy: Prisma.TicketTaskOrderByWithRelationInput =
    q.sort === "dueDate" ? { dueDate: { sort: q.dir, nulls: "last" } } : { [q.sort]: q.dir };
  const [total, rows] = await prisma.$transaction([
    prisma.ticketTask.count({ where }),
    prisma.ticketTask.findMany({ where, include: taskRowInclude, orderBy: [orderBy, { createdAt: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, rows, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

