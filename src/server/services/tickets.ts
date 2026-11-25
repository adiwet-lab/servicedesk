import { z } from "zod";
import { nameTh } from "@/i18n/server-text";
import { randomUUID, createHash } from "node:crypto";
import type { Prisma, StatusKind } from "@prisma/client";
import { prisma } from "@/server/db";
import { transaction } from "@/server/db-tx";
import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { can, requirePermission } from "@/server/authz/guards";
import { NotFoundError, ValidationError, AuthorizationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { canAssignTicket, canManageTicketTasks, canWorkTicket, taskScopeWhere, ticketScopeWhere } from "@/server/authz/scope";
import { ACTIVE_KINDS, isTransitionAllowed, validateTransition } from "@/server/domain/workflow";
import { resolveRouting } from "@/server/domain/routing";
import { agingRange } from "@/server/domain/analytics";
import { enforceRateLimit } from "@/server/ratelimit";
import { getStorage } from "@/server/storage/provider";
import { validateUploads, type UploadCandidate } from "@/server/storage/validate";
import {
  createTicketSchema,
  CONFIGURABLE_REQUIRED_FIELDS,
  type RequiredFieldKey,
  type TicketListQuery,
} from "@/lib/validation/ticket";
import { audit } from "./audit";
import { nextNumber } from "./numbering";
import { notifyUsers, teamMemberIds } from "./notifications";
import { getSettings } from "./settings";
import { applyStatusChange, computeSlaTargets, recordFirstResponse, startClocks } from "./sla";
import { normaliseCreateImpact, validateImpact } from "@/server/domain/impact";
import { planApprovals, startApprovals } from "./approvals";
import { ln } from "@/lib/localized";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { AttachmentBlockedError, AttachmentScanPendingError, downloadDecision, initialScanStatus, refreshScan } from "@/server/storage/malware-scan";
import { enqueueTeamsCard } from "@/server/integrations/teams";
import { queueEvent, rooms } from "@/server/realtime/bus";

// ───────────────────────────── Listing ─────────────────────────────

export const TICKET_VIEWS = [
  "my", "department", "branch", "all", "unassigned", "myteam", "assigned", "overdue", "breached", "search",
] as const;
export type TicketView = (typeof TICKET_VIEWS)[number];

/** Which list views the actor may open (drives navigation + guards direct URL access). */
export function availableViews(actor: Actor): Set<TicketView> {
  const v = new Set<TicketView>();
  // Global search spans everything the actor can see (scope-filtered).
  if (can(actor, P.TICKET_READ_OWN) || can(actor, P.TICKET_READ_TEAM) || can(actor, P.TICKET_READ_ALL)) v.add("search");
  if (can(actor, P.TICKET_READ_OWN)) v.add("my");
  if (!isVendor(actor) && can(actor, P.TICKET_READ_OWN)) {
    if ((actor.ticketVisibility === "OWN_DEPT" || actor.ticketVisibility === "OWN_DEPT_BRANCH") && actor.departmentId) v.add("department");
    if ((actor.ticketVisibility === "OWN_BRANCH" || actor.ticketVisibility === "OWN_DEPT_BRANCH") && actor.branchId) v.add("branch");
  }
  if (can(actor, P.TICKET_READ_TEAM) || can(actor, P.TICKET_READ_ALL)) {
    for (const x of ["all", "unassigned", "myteam", "assigned", "overdue", "breached"] as const) v.add(x);
  }
  return v;
}

function viewWhere(actor: Actor, view: TicketView, now: Date): Prisma.TicketWhereInput {
  const active = { status: { kind: { in: ACTIVE_KINDS } } };
  switch (view) {
    case "my":
      return { requesterId: actor.id };
    case "department":
      return { departmentId: actor.departmentId ?? "__none__" };
    case "branch":
      return { branchId: actor.branchId ?? "__none__" };
    case "unassigned":
      return { assignedAgentId: null, ...active };
    case "myteam":
      return { ownerTeamId: { in: actor.teamIds } };
    case "assigned":
      return { assignedAgentId: actor.id };
    case "overdue":
      return { resolutionDueAt: { lt: now }, slaPausedAt: null, ...active };
    case "breached":
      return { OR: [{ resolutionBreached: true }, { responseBreached: true }, { resolutionDueAt: { lt: now }, slaPausedAt: null, ...active }] };
    case "all":
    default:
      return {};
  }
}

export const ticketListInclude = {
  category: { select: { id: true, name: true, nameTh: true } },
  subcategory: { select: { id: true, name: true, nameTh: true } },
  priority: { select: { id: true, code: true, name: true, nameTh: true, color: true, level: true } },
  status: { select: { id: true, name: true, nameTh: true, color: true, kind: true, pausesSla: true } },
  requester: { select: { id: true, displayName: true, email: true } },
  department: { select: { id: true, name: true, nameTh: true } },
  branch: { select: { id: true, name: true, nameTh: true } },
  ownerTeam: { select: { id: true, name: true, nameTh: true, code: true } },
  assignedAgent: { select: { id: true, displayName: true } },
  slaEvents: { where: { type: "WARNING" }, select: { clock: true }, take: 2 },
} satisfies Prisma.TicketInclude;

export type TicketListRow = Prisma.TicketGetPayload<{ include: typeof ticketListInclude }>;

export async function listTickets(actor: Actor, view: TicketView, q: TicketListQuery) {
  if (!availableViews(actor).has(view)) throw new AuthorizationError();
  const now = new Date();
  const filters: Prisma.TicketWhereInput[] = [ticketScopeWhere(actor), viewWhere(actor, view, now)];
  if (q.status) filters.push({ statusId: q.status });
  if (q.priority) filters.push({ priorityId: q.priority });
  if (q.category) filters.push({ OR: [{ categoryId: q.category }, { subcategoryId: q.category }] });
  if (q.team) filters.push({ ownerTeamId: q.team });
  if (q.agent) filters.push({ assignedAgentId: q.agent === "none" ? null : q.agent });
  if (q.branch) filters.push({ branchId: q.branch });
  if (q.department) filters.push({ departmentId: q.department });
  if (q.subcategory) filters.push({ subcategoryId: q.subcategory });
  if (q.company) filters.push({ companyId: q.company });
  if (q.from) filters.push({ createdAt: { gte: new Date(`${q.from}T00:00:00Z`) } });
  if (q.to) filters.push({ createdAt: { lte: new Date(`${q.to}T23:59:59.999Z`) } });
  if (q.aging) filters.push({ createdAt: agingRange(q.aging, now), status: { kind: { in: ACTIVE_KINDS } } });
  if (q.q) {
    const s = q.q;
    const ci = { contains: s, mode: "insensitive" as const };
    filters.push({
      OR: [
        { number: ci },
        { subject: ci },
        { relatedAsset: ci },
        { requester: { OR: [{ displayName: ci }, { email: ci }, { employeeId: ci }] } },
      ],
    });
  }
  const where: Prisma.TicketWhereInput = { AND: filters };
  const orderBy: Prisma.TicketOrderByWithRelationInput =
    q.sort === "priority" ? { priority: { level: q.dir } }
    : q.sort === "status" ? { status: { order: q.dir } }
    : q.sort === "resolutionDueAt" ? { resolutionDueAt: { sort: q.dir, nulls: "last" } }
    : { [q.sort]: q.dir };

  const [total, rows] = await prisma.$transaction([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      include: ticketListInclude,
      orderBy: [orderBy, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { total, rows, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

// ───────────────────────────── Summary ─────────────────────────────

/** Status counts within the actor's scope (optionally narrowed, e.g. to own tickets). */
export async function ticketSummary(actor: Actor, narrow: Prisma.TicketWhereInput = {}) {
  const where: Prisma.TicketWhereInput = { AND: [ticketScopeWhere(actor), narrow] };
  const now = new Date();
  const [groups, statuses, overdue] = await Promise.all([
    prisma.ticket.groupBy({ by: ["statusId"], where, _count: { _all: true } }),
    prisma.ticketStatus.findMany({ where: { isActive: true }, orderBy: { order: "asc" } }),
    prisma.ticket.count({ where: { AND: [where, { resolutionDueAt: { lt: now }, slaPausedAt: null, status: { kind: { in: ACTIVE_KINDS } } }] } }),
  ]);
  const byStatus = new Map(groups.map((g) => [g.statusId, g._count._all]));
  const total = groups.reduce((a, g) => a + g._count._all, 0);
  return {
    total,
    overdue,
    statuses: statuses.map((s) => ({ id: s.id, name: s.name, nameTh: s.nameTh, kind: s.kind, color: s.color, count: byStatus.get(s.id) ?? 0 })),
  };
}

// ───────────────────────────── Detail ─────────────────────────────

export async function getTicketDetail(actor: Actor, idOrNumber: string) {
  const ticket = await prisma.ticket.findFirst({
    where: { AND: [ticketScopeWhere(actor), { OR: [{ id: idOrNumber }, { number: idOrNumber }] }] },
    include: {
      ...ticketListInclude,
      company: { select: { id: true, name: true } },
      location: { select: { id: true, name: true, nameTh: true } },
      createdBy: { select: { id: true, displayName: true } },
      requester: {
        select: { id: true, displayName: true, email: true, employeeId: true, jobTitle: true, contactNumber: true,
          department: { select: { name: true, nameTh: true } }, branch: { select: { name: true, nameTh: true } } },
      },
      slaProfile: { select: { id: true, name: true, warningPercent: true } },
      attachments: {
        where: { deletedAt: null, messageId: null, taskId: null },
        include: { uploadedBy: { select: { displayName: true } } },
        orderBy: { createdAt: "asc" },
      },
      history: { include: { actor: { select: { displayName: true } } }, orderBy: { createdAt: "desc" }, take: 500 },
      supportingTeams: { include: { team: { select: { id: true, name: true, nameTh: true, type: true } } }, orderBy: { addedAt: "asc" } },
      assignments: {
        include: {
          prevTeam: { select: { name: true, nameTh: true } }, newTeam: { select: { name: true, nameTh: true } },
          prevAgent: { select: { displayName: true } }, newAgent: { select: { displayName: true } },
          changedBy: { select: { displayName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      tasks: { select: { id: true, number: true, title: true, isRequired: true, status: true, teamId: true, assignedAgentId: true } },
    },
  });
  if (!ticket) throw new NotFoundError("Ticket not found or you do not have access.");

  // Vendors only see timeline entries of tasks they can see.
  const visibleTaskNumbers = new Set(
    isVendor(actor)
      ? ticket.tasks.filter((t) => t.assignedAgentId === actor.id || (t.teamId && actor.teamIds.includes(t.teamId))).map((t) => t.number)
      : ticket.tasks.map((t) => t.number),
  );
  const timeline = ticket.history
    .filter((h) => {
      if (!h.action.startsWith("TASK_")) return true;
      const num = h.field ?? h.newValue?.split(" ")[0] ?? "";
      return visibleTaskNumbers.has(num);
    })
    .map((h) => ({ ...h, category: timelineCategory(h.action) }));
  const openTasksByTeam = new Map<string, number>();
  for (const t of ticket.tasks) {
    if (t.teamId && t.status !== "COMPLETED" && t.status !== "CANCELLED") openTasksByTeam.set(t.teamId, (openTasksByTeam.get(t.teamId) ?? 0) + 1);
  }

  const isRequester = ticket.requesterId === actor.id;
  const canWork = canWorkTicket(actor, ticket);
  const settings = await getSettings(prisma);
  const transitions = await prisma.workflowTransition.findMany({
    where: { fromStatusId: ticket.statusId, toStatus: { isActive: true } },
    include: { toStatus: true },
    orderBy: { toStatus: { order: "asc" } },
  });
  const openRequiredTasks = ticket.tasks.filter((t) => t.isRequired && t.status !== "COMPLETED" && t.status !== "CANCELLED").length;
  const allowedTransitions = transitions
    .filter((tr) =>
      isTransitionAllowed({
        actor, isRequester, canWork, from: ticket.status as never, to: tr.toStatus, transition: tr,
        resolvedAt: ticket.resolvedAt, reopenWindowDays: settings["tickets.reopenWindowDays"], openRequiredTasks, approvalPending: ticket.approvalStatus === "PENDING",
      }),
    )
    .map((tr) => ({ id: tr.toStatus.id, name: tr.toStatus.name, kind: tr.toStatus.kind, color: tr.toStatus.color,
      requiresReason: tr.toStatus.requiresReason || tr.toStatus.kind === "WAITING" || tr.requiresComment }));

  const closedLocked = ["CLOSED", "CANCELLED"].includes(ticket.status.kind) && !can(actor, P.TICKET_CLOSED_EDIT);
  const blockingTasks = ticket.tasks
    .filter((t) => t.isRequired && t.status !== "COMPLETED" && t.status !== "CANCELLED" && visibleTaskNumbers.has(t.number))
    .map((t) => ({ number: t.number, title: t.title }));

  return {
    ticket,
    timeline,
    openTasksByTeam: Object.fromEntries(openTasksByTeam),
    permissions: {
      isRequester,
      canWork,
      canAssign: canAssignTicket(actor, ticket),
      canTransfer: canAssignTicket(actor, ticket) && (can(actor, P.TICKET_TRANSFER) || can(actor, P.TICKET_READ_ALL)),
      canUpload: (isRequester || canWork) && !["CLOSED", "CANCELLED"].includes(ticket.status.kind),
      canEdit: canWork && !isVendor(actor) && !closedLocked,
      canEscalate: can(actor, P.TICKET_ESCALATE) && !isVendor(actor) && canWork && !closedLocked,
      canManageTasks: canManageTicketTasks(actor, ticket) && !closedLocked,
      canManageSupportingTeams: canAssignTicket(actor, ticket) && !closedLocked,
    },
    allowedTransitions,
    openRequiredTasks,
    blockingTasks,
  };
}

// ───────────────────────────── Create ─────────────────────────────

export interface CreateTicketResult {
  id: string;
  number: string;
}

export async function createTicket(actor: Actor, raw: unknown, files: UploadCandidate[] = [], opts: { channel?: "FORM" | "CHAT" } = {}): Promise<CreateTicketResult> {
  const channel = opts.channel ?? "FORM";
  requirePermission(actor, P.TICKET_CREATE);
  await enforceRateLimit(`ticket:create:${actor.id}`, 20, 60 * 60 * 1000);

  // Chat cases are conversations: a short first message ("printer broken") is fine — the agent asks for more.
  const schema = channel === "CHAT"
    ? createTicketSchema.extend({ subject: z.string().trim().min(1).max(200), description: z.string().trim().min(1, "Write a message or attach a file.").max(20000) })
    : createTicketSchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    throw new ValidationError("Please correct the highlighted fields.", fieldErrors);
  }
  const input = parsed.data;
  const settings = await getSettings(prisma);

  // Category / subcategory
  const category = await prisma.category.findFirst({
    where: { id: input.categoryId, parentId: null, isActive: true, deletedAt: null },
    include: { children: { where: { isActive: true, deletedAt: null }, select: { id: true } } },
  });
  if (!category) throw new ValidationError("Invalid category.", { categoryId: "Select a valid main category" });
  let subcategory = null;
  if (input.subcategoryId) {
    subcategory = await prisma.category.findFirst({
      where: { id: input.subcategoryId, parentId: category.id, isActive: true, deletedAt: null },
    });
    if (!subcategory) throw new ValidationError("Invalid subcategory.", { subcategoryId: "Select a valid subcategory" });
  } else if (category.children.length > 0) {
    throw new ValidationError("Subcategory is required.", { subcategoryId: "Subcategory is required" });
  }

  // Configurable required fields (union of main + sub)
  const required = new Set<RequiredFieldKey>([
    ...((category.requiredFields as RequiredFieldKey[]) ?? []),
    ...((subcategory?.requiredFields as RequiredFieldKey[]) ?? []),
  ]);
  const fieldErrors: Record<string, string> = {};
  for (const key of required) {
    if (!(key in CONFIGURABLE_REQUIRED_FIELDS)) continue;
    const missing = key === "attachments" ? files.length === 0 : !input[key as Exclude<RequiredFieldKey, "attachments">];
    if (missing) fieldErrors[key] = `${CONFIGURABLE_REQUIRED_FIELDS[key]} is required for this category`;
  }
  if (Object.keys(fieldErrors).length) throw new ValidationError("Please fill in the required fields.", fieldErrors);

  // Requester: self, or on behalf of someone (internal support staff only)
  let requester = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (input.requesterId && input.requesterId !== actor.id) {
    if (!can(actor, P.TICKET_UPDATE) || isVendor(actor)) throw new AuthorizationError("You cannot create tickets on behalf of others.");
    const other = await prisma.user.findFirst({ where: { id: input.requesterId, status: "ACTIVE", deletedAt: null } });
    if (!other) throw new ValidationError("Requester not found.", { requesterId: "Requester not found" });
    requester = other;
  }

  // Priority
  let priorityId: string | null = null;
  if (input.priorityId && (settings["tickets.requesterCanSetPriority"] || can(actor, P.TICKET_UPDATE))) {
    const p = await prisma.priority.findFirst({ where: { id: input.priorityId, isActive: true } });
    if (!p) throw new ValidationError("Invalid priority.", { priorityId: "Invalid priority" });
    priorityId = p.id;
  }
  priorityId ??= subcategory?.defaultPriorityId ?? category.defaultPriorityId ?? null;
  if (!priorityId) {
    const p =
      (await prisma.priority.findFirst({ where: { code: settings["tickets.defaultPriorityCode"], isActive: true } })) ??
      (await prisma.priority.findFirst({ where: { isActive: true }, orderBy: { level: "desc" } }));
    if (!p) throw new Error("No priorities configured.");
    priorityId = p.id;
  }

  // Branch / location (default from requester profile)
  const branchId = input.branchId ?? requester.branchId;
  if (input.branchId) {
    const b = await prisma.branch.findFirst({ where: { id: input.branchId, isActive: true, deletedAt: null } });
    if (!b) throw new ValidationError("Invalid branch.", { branchId: "Invalid branch" });
  }
  let locationId = input.locationId ?? (input.branchId ? null : requester.locationId);
  if (input.locationId) {
    const l = await prisma.location.findFirst({ where: { id: input.locationId, isActive: true, deletedAt: null } });
    if (!l || (branchId && l.branchId !== branchId)) throw new ValidationError("Invalid location.", { locationId: "Location does not belong to the branch" });
    locationId = l.id;
  }

  // Branch impact (optional)
  const impact = normaliseCreateImpact(input.impactScope, input.impactBranchIds, branchId);
  if (impact) {
    const err = validateImpact(impact);
    if (err) throw new ValidationError(err, { impactScope: err });
    if (impact.branchIds.length && (await prisma.branch.count({ where: { id: { in: impact.branchIds }, deletedAt: null } })) !== impact.branchIds.length)
      throw new ValidationError("Unknown impacted branch.", { impactScope: "Unknown impacted branch" });
  }

  const defaultStatus = await prisma.ticketStatus.findFirst({ where: { isDefault: true, isActive: true } })
    ?? (await prisma.ticketStatus.findFirst({ where: { kind: "NEW", isActive: true }, orderBy: { order: "asc" } }));
  if (!defaultStatus) throw new Error("No initial ticket status configured.");

  // Routing
  const [rules, fallbackTeam] = await Promise.all([
    prisma.routingRule.findMany({ where: { isActive: true, targetTeam: { isActive: true, deletedAt: null } } }),
    prisma.supportTeam.findFirst({ where: { code: settings["tickets.fallbackTeamCode"], isActive: true, deletedAt: null } }),
  ]);
  const routing = resolveRouting({
    ticket: { categoryId: category.id, subcategoryId: subcategory?.id ?? null, priorityId, companyId: requester.companyId, departmentId: requester.departmentId, branchId },
    category, subcategory, rules, fallbackTeamId: fallbackTeam?.id ?? null,
  });

  // Attachments — validate before touching the DB
  let uploads: Extract<ReturnType<typeof validateUploads>, { ok: true }>["files"] = [];
  if (files.length) {
    const v = validateUploads(files, {
      maxFileSizeMb: settings["attachments.maxFileSizeMb"],
      maxFiles: settings["attachments.maxFilesPerUpload"],
      allowedExtensions: settings["attachments.allowedExtensions"],
    });
    if ("error" in v) throw new ValidationError(v.error, { attachments: v.error });
    uploads = v.files;
  }

  // Approval policy (subcategory first, then category) — resolved before anything is written.
  const approvalPlan = await planApprovals(prisma, category.id, subcategory?.id ?? null, { id: requester.id, managerId: requester.managerId });

  const now = new Date();
  const sla = await computeSlaTargets(prisma, {
    subcategorySlaProfileId: subcategory?.slaProfileId, categorySlaProfileId: category.slaProfileId,
    teamId: routing.teamId, priorityId, start: now,
  });

  // Store blobs first (random keys); roll back blobs if the DB transaction fails.
  const storage = await getStorage();
  const stored: { key: string; f: (typeof uploads)[number]; sha: string }[] = [];
  for (const f of uploads) {
    const key = `tickets/${now.getFullYear()}/${randomUUID()}`;
    await storage.put(key, f.data, f.mime);
    stored.push({ key, f, sha: createHash("sha256").update(f.data).digest("hex") });
  }

  try {
    return await transaction(async (tx) => {
      const number = await nextNumber(tx, "TICKET", now);
      const ticket = await tx.ticket.create({
        data: {
          number,
          subject: input.subject,
          description: input.description,
          categoryId: category.id,
          subcategoryId: subcategory?.id ?? null,
          priorityId: priorityId!,
          statusId: defaultStatus.id,
          requesterId: requester.id,
          createdById: actor.id,
          companyId: requester.companyId,
          departmentId: requester.departmentId,
          branchId,
          locationId,
          contactNumber: input.contactNumber ?? requester.contactNumber,
          relatedAsset: input.relatedAsset,
          affectedSystem: input.affectedSystem,
          affectedUsers: input.affectedUsers,
          isConfidential: input.isConfidential,
          impactScope: impact?.impactScope ?? null,
          impactedBranches: impact?.branchIds.length ? { create: impact.branchIds.map((id) => ({ branchId: id })) } : undefined,
          ownerTeamId: routing.teamId,
          assignedAgentId: routing.agentId,
          channel,
          ...sla,
          createdAt: now,
        },
      });
      // Chat cases: the details (and files) are the first message of the conversation.
      const firstMessage = channel === "CHAT"
        ? await tx.ticketMessage.create({ data: { ticketId: ticket.id, senderId: actor.id, type: "PUBLIC", body: input.description, createdAt: now } })
        : null;
      await tx.ticketHistory.create({
        data: { ticketId: ticket.id, actorId: actor.id, action: "CREATED", newValue: `${number} — ${input.subject}` },
      });
      await startClocks(tx, ticket.id, sla.responseTargetMin != null);
      if (approvalPlan) await startApprovals(tx, actor, { id: ticket.id, number, subject: input.subject }, approvalPlan, now);
      if (routing.teamId) {
        await tx.ticketAssignment.create({
          data: {
            ticketId: ticket.id, type: "AUTO", newTeamId: routing.teamId, newAgentId: routing.agentId,
            changedById: actor.id, reason: `Auto-routed by ${routing.source}${routing.ruleId ? ` (${routing.ruleId})` : ""}`,
          },
        });
      }
      for (const s of stored) {
        await tx.ticketAttachment.create({
          data: {
            ticketId: ticket.id, uploadedById: actor.id, fileName: s.f.safeName, mimeType: s.f.mime, messageId: firstMessage?.id ?? null,
            sizeBytes: s.f.size, sha256: s.sha, storageKey: s.key, scanStatus: await initialScanStatus(tx),
          },
        });
      }
      await audit(tx, actor, {
        action: "TICKET_CREATED", entityType: "Ticket", entityId: ticket.id, ticketId: ticket.id,
        newValue: { number, subject: input.subject, categoryId: category.id, subcategoryId: subcategory?.id, priorityId,
          ownerTeamId: routing.teamId, routing: routing.source, attachments: stored.length },
      });
      if (stored.length) {
        await audit(tx, actor, { action: "ATTACHMENT_ADDED", entityType: "Ticket", entityId: ticket.id, ticketId: ticket.id,
          newValue: stored.map((s) => s.f.safeName) });
      }

      await enqueueTeamsCard(tx, { teamId: routing.teamId, event: "TICKET_CREATED", ticketId: ticket.id, title: `New ticket ${number}`,
        extraFacts: [["Category", `${category.name}${subcategory ? ` › ${subcategory.name}` : ""}`], ["Requester", requester.displayName]], tone: "accent" });
      const link = `/tickets/${number}`;
      const teamUsers = routing.agentId ? [routing.agentId] : await teamMemberIds(tx, routing.teamId);
      await notifyUsers(tx, teamUsers, { type: "TICKET_CREATED", key: "ticketCreated", params: { number, subject: input.subject }, title: `New ticket ${number}`, body: input.subject, ticketId: ticket.id, link }, actor);
      if (requester.id !== actor.id) {
        await notifyUsers(tx, [requester.id], { type: "TICKET_CREATED", key: "ticketLogged", params: { number, subject: input.subject }, title: `Ticket ${number} was logged for you`, body: input.subject, ticketId: ticket.id, link }, actor);
      }
      if (channel === "CHAT") {
        queueEvent(tx, { room: rooms.chatQueue, event: "chat:new", payload: { ticketId: ticket.id } });
        if (routing.agentId) queueEvent(tx, { room: rooms.chatQueue, event: "chat:claimed", payload: { ticketId: ticket.id } });
      }
      return { id: ticket.id, number };
    });
  } catch (e) {
    await Promise.allSettled(stored.map((s) => storage.delete(s.key)));
    throw e;
  }
}

// ───────────────────────────── Status change ─────────────────────────────

export async function loadTicketForMutation(actor: Actor, ticketId: string) {
  const t = await prisma.ticket.findFirst({
    where: { AND: [ticketScopeWhere(actor), { id: ticketId }] },
    include: { status: true, tasks: { select: { isRequired: true, status: true } } },
  });
  if (!t) throw new NotFoundError("Ticket not found or you do not have access.");
  return t;
}

export async function changeTicketStatus(
  actor: Actor,
  input: { ticketId: string; toStatusId: string; reason?: string; resolutionSummary?: string },
) {
  const ticket = await loadTicketForMutation(actor, input.ticketId);
  const to = await prisma.ticketStatus.findFirst({ where: { id: input.toStatusId, isActive: true } });
  if (!to) throw new ValidationError("Unknown status.");
  const transition = await prisma.workflowTransition.findUnique({
    where: { fromStatusId_toStatusId: { fromStatusId: ticket.statusId, toStatusId: to.id } },
  });
  const settings = await getSettings(prisma);
  const isRequester = ticket.requesterId === actor.id;
  const canWork = canWorkTicket(actor, ticket);
  const openRequiredTasks = ticket.tasks.filter((t) => t.isRequired && t.status !== "COMPLETED" && t.status !== "CANCELLED").length;
  const now = new Date();

  const error = validateTransition(
    { actor, isRequester, canWork, from: ticket.status, to, transition, resolvedAt: ticket.resolvedAt,
      reopenWindowDays: settings["tickets.reopenWindowDays"], openRequiredTasks, approvalPending: ticket.approvalStatus === "PENDING", now },
    input,
  );
  if (error) {
    if (error.startsWith("You are not allowed")) throw new AuthorizationError(error);
    throw new ValidationError(error);
  }

  const fromKind = ticket.status.kind;
  const upd: Prisma.TicketUncheckedUpdateInput = { statusId: to.id };
  upd.waitingReason = to.kind === "WAITING" || to.requiresReason ? input.reason : null;
  if (to.kind === "RESOLVED") {
    upd.resolutionSummary = input.resolutionSummary;
    upd.resolvedAt = now;
  }
  if (to.kind === "CLOSED") upd.closedAt = now;
  const reopening = (fromKind === "RESOLVED" || fromKind === "CLOSED" || fromKind === "CANCELLED") && ACTIVE_KINDS.includes(to.kind);
  if (reopening) {
    upd.resolvedAt = null;
    upd.closedAt = null;
  }
  // First response = first status change by support staff out of NEW.
  const firstResponse = !ticket.firstResponseAt && canWork && !isRequester && fromKind === "NEW";

  await transaction(async (tx) => {
    // SLA: pause/resume per profile pause conditions, resolution met/breached, response met.
    Object.assign(upd, await applyStatusChange(tx, ticket, to, now));
    if (firstResponse) Object.assign(upd, await recordFirstResponse(tx, ticket, now));
    if (to.kind === "CANCELLED" && ticket.approvalStatus === "PENDING") {
      // Withdraw open approval requests; the ticket cannot be reopened without a new request.
      await tx.ticketApproval.updateMany({ where: { ticketId: ticket.id, decision: { in: ["PENDING", "WAITING"] } }, data: { decision: "CANCELLED" } });
    }
    // Optimistic concurrency: only succeeds if status unchanged since we read it.
    const res = await tx.ticket.updateMany({ where: { id: ticket.id, statusId: ticket.statusId }, data: upd as Prisma.TicketUncheckedUpdateManyInput });
    if (res.count !== 1) throw new ValidationError("The ticket was changed by someone else. Please reload and try again.");
    await tx.ticketHistory.create({
      data: {
        ticketId: ticket.id, actorId: actor.id, action: reopening ? "REOPENED" : "STATUS_CHANGED", field: "status",
        oldValue: ticket.status.name, newValue: to.name,
        reason: to.kind === "RESOLVED" ? input.resolutionSummary : input.reason,
      },
    });
    await audit(tx, actor, {
      action: "STATUS_CHANGED", entityType: "Ticket", entityId: ticket.id, ticketId: ticket.id,
      oldValue: { status: ticket.status.name }, newValue: { status: to.name, reason: input.reason, resolutionSummary: input.resolutionSummary },
    });
    const type = to.kind === "RESOLVED" ? "TICKET_RESOLVED" : to.kind === "CLOSED" ? "TICKET_CLOSED" : "STATUS_CHANGED";
    await notifyUsers(tx, [ticket.requesterId, ticket.assignedAgentId], {
      type, key: "statusChanged", params: { number: ticket.number, from: ticket.status.name, fromTh: nameTh(ticket.status), to: to.name, toTh: nameTh(to), text: input.reason ?? input.resolutionSummary ?? ticket.subject }, title: `${ticket.number}: ${ticket.status.name} → ${to.name}`, body: input.reason ?? input.resolutionSummary ?? ticket.subject,
      ticketId: ticket.id, link: `/tickets/${ticket.number}`,
    }, actor);
  });
}

// ───────────────────────────── Assignment ─────────────────────────────

export async function assignTicket(actor: Actor, input: { ticketId: string; teamId?: string; agentId?: string; reason?: string }) {
  const ticket = await loadTicketForMutation(actor, input.ticketId);
  if (!canAssignTicket(actor, ticket)) throw new AuthorizationError("You cannot assign this ticket.");
  if (["CLOSED", "CANCELLED"].includes(ticket.status.kind) && !can(actor, P.TICKET_CLOSED_EDIT)) {
    throw new ValidationError("Closed tickets cannot be reassigned.");
  }

  const newTeamId = input.teamId ?? ticket.ownerTeamId;
  if (!newTeamId) throw new ValidationError("A team is required.");
  const teamChanged = newTeamId !== ticket.ownerTeamId;
  if (teamChanged && !(can(actor, P.TICKET_TRANSFER) || can(actor, P.TICKET_READ_ALL))) {
    throw new AuthorizationError("You do not have permission to transfer tickets to another team.");
  }
  const team = await prisma.supportTeam.findFirst({ where: { id: newTeamId, isActive: true, deletedAt: null } });
  if (!team) throw new ValidationError("Team not found or inactive.");

  let newAgentId: string | null = input.agentId ?? null;
  if (!teamChanged && input.agentId === undefined) newAgentId = ticket.assignedAgentId;
  if (newAgentId) {
    const member = await prisma.teamMember.findFirst({
      where: { teamId: newTeamId, userId: newAgentId, user: { status: "ACTIVE", deletedAt: null } },
    });
    if (!member) throw new ValidationError("The selected agent is not an active member of the team.");
  }
  if (!teamChanged && newAgentId === ticket.assignedAgentId) throw new ValidationError("Nothing to change.");
  if (teamChanged && !input.reason) throw new ValidationError("A reason is required when transferring to another team.");
  await commitAssignment(actor, ticket, { team, newAgentId, reason: input.reason });
}

type MutationTicket = Awaited<ReturnType<typeof loadTicketForMutation>>;

/**
 * Writes an (already authorized and validated) team/agent change: auto "Assigned" status, SLA first response,
 * assignment row, history, audit, notifications and Teams card. With `onlyIfUnclaimed` the write only happens
 * when the ticket still has no agent (atomic claim); otherwise it throws "already claimed".
 */
export async function commitAssignment(
  actor: Actor, ticket: MutationTicket,
  input: { team: { id: string; name: string; nameTh: string | null }; newAgentId: string | null; reason?: string; onlyIfUnclaimed?: boolean },
) {
  const { team, newAgentId } = input;
  const newTeamId = team.id;
  const teamChanged = newTeamId !== ticket.ownerTeamId;
  const type = teamChanged ? "TRANSFER" : ticket.assignedAgentId ? "REASSIGN" : "ASSIGN";
  const settings = await getSettings(prisma);

  // Auto-advance NEW → "Assigned" status when an agent is assigned and the workflow allows it.
  let autoStatus: { id: string; name: string; code: string; kind: StatusKind; pausesSla: boolean } | null = null;
  if (newAgentId && ticket.status.kind === "NEW" && ticket.approvalStatus !== "PENDING") {
    const assigned = await prisma.ticketStatus.findFirst({ where: { code: settings["workflow.assignedStatusCode"], isActive: true } });
    if (assigned) {
      const tr = await prisma.workflowTransition.findUnique({ where: { fromStatusId_toStatusId: { fromStatusId: ticket.statusId, toStatusId: assigned.id } } });
      if (tr) autoStatus = assigned;
    }
  }

  await transaction(async (tx) => {
    const now = new Date();
    if (input.onlyIfUnclaimed) {
      const claimed = await tx.ticket.updateMany({ where: { id: ticket.id, assignedAgentId: null }, data: { assignedAgentId: newAgentId } });
      if (claimed.count === 0) throw new ValidationError("This chat has already been claimed by someone else.");
    }
    const slaData = autoStatus
      ? { ...(await applyStatusChange(tx, ticket, autoStatus, now)), ...(await recordFirstResponse(tx, ticket, now)) }
      : {};
    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        ownerTeamId: newTeamId, assignedAgentId: newAgentId,
        ...(autoStatus ? { statusId: autoStatus.id } : {}),
        ...slaData,
      },
    });
    await tx.ticketAssignment.create({
      data: {
        ticketId: ticket.id, type, prevTeamId: ticket.ownerTeamId, newTeamId, prevAgentId: ticket.assignedAgentId,
        newAgentId, changedById: actor.id, reason: input.reason,
      },
    });
    if (teamChanged) {
      await tx.ticketHistory.create({ data: { ticketId: ticket.id, actorId: actor.id, action: "TEAM_CHANGED", field: "ownerTeam",
        oldValue: ticket.ownerTeamId, newValue: team.name, reason: input.reason } });
    }
    if (newAgentId !== ticket.assignedAgentId) {
      const names = await tx.user.findMany({ where: { id: { in: [ticket.assignedAgentId, newAgentId].filter(Boolean) as string[] } }, select: { id: true, displayName: true } });
      const nm = (id: string | null) => names.find((n) => n.id === id)?.displayName ?? null;
      await tx.ticketHistory.create({ data: { ticketId: ticket.id, actorId: actor.id, action: "AGENT_CHANGED", field: "assignedAgent",
        oldValue: nm(ticket.assignedAgentId), newValue: nm(newAgentId) ?? "Unassigned", reason: input.reason } });
    }
    if (autoStatus) {
      await tx.ticketHistory.create({ data: { ticketId: ticket.id, actorId: actor.id, action: "STATUS_CHANGED", field: "status",
        oldValue: ticket.status.name, newValue: autoStatus.name, reason: "Auto on assignment" } });
    }
    await audit(tx, actor, {
      action: teamChanged ? "TEAM_CHANGED" : "AGENT_CHANGED", entityType: "Ticket", entityId: ticket.id, ticketId: ticket.id,
      oldValue: { ownerTeamId: ticket.ownerTeamId, assignedAgentId: ticket.assignedAgentId },
      newValue: { ownerTeamId: newTeamId, assignedAgentId: newAgentId, type, reason: input.reason },
    });
    const link = `/tickets/${ticket.number}`;
    if (newAgentId) {
      await notifyUsers(tx, [newAgentId], { type: type === "ASSIGN" ? "TICKET_ASSIGNED" : "TICKET_REASSIGNED",
        key: "assignedToYou", params: { number: ticket.number, subject: ticket.subject }, title: `${ticket.number} assigned to you`, body: ticket.subject, ticketId: ticket.id, link }, actor);
    }
    if (teamChanged) {
      await notifyUsers(tx, await teamMemberIds(tx, newTeamId), { type: "TICKET_TRANSFERRED",
        key: "transferred", params: { number: ticket.number, team: team.name, teamTh: nameTh(team), reason: input.reason ?? "" }, title: `${ticket.number} transferred to ${team.name}`, body: input.reason, ticketId: ticket.id, link }, actor);
      await enqueueTeamsCard(tx, { teamId: newTeamId, event: "TICKET_TRANSFERRED", ticketId: ticket.id, title: `${ticket.number} transferred to ${team.name}`,
        extraFacts: [["Reason", input.reason]], tone: "accent" });
    }
    await notifyUsers(tx, [ticket.requesterId], { type: "TICKET_ASSIGNED", key: "requesterAssigned", params: { number: ticket.number, subject: ticket.subject }, title: `${ticket.number} has been assigned`,
      body: ticket.subject, ticketId: ticket.id, link }, actor);
  });
}

// ───────────────────────────── Attachments ─────────────────────────────

export async function addTicketAttachments(actor: Actor, ticketId: string, files: UploadCandidate[]) {
  await enforceRateLimit(`upload:${actor.id}`, 60, 60 * 60 * 1000);
  const ticket = await loadTicketForMutation(actor, ticketId);
  const isRequester = ticket.requesterId === actor.id;
  if (!isRequester && !canWorkTicket(actor, ticket)) throw new AuthorizationError();
  if (["CLOSED", "CANCELLED"].includes(ticket.status.kind) && !can(actor, P.TICKET_CLOSED_EDIT)) {
    throw new ValidationError("Closed tickets cannot be modified.");
  }
  const settings = await getSettings(prisma);
  const v = validateUploads(files, {
    maxFileSizeMb: settings["attachments.maxFileSizeMb"],
    maxFiles: settings["attachments.maxFilesPerUpload"],
    allowedExtensions: settings["attachments.allowedExtensions"],
  });
  if ("error" in v) throw new ValidationError(v.error);
  const storage = await getStorage();
  const stored: { key: string; f: (typeof v.files)[number] }[] = [];
  try {
    for (const f of v.files) {
      const key = `tickets/${new Date().getFullYear()}/${randomUUID()}`;
      await storage.put(key, f.data, f.mime);
      stored.push({ key, f });
    }
    await transaction(async (tx) => {
      for (const s of stored) {
        await tx.ticketAttachment.create({
          data: { ticketId, uploadedById: actor.id, fileName: s.f.safeName, mimeType: s.f.mime, sizeBytes: s.f.size,
            sha256: createHash("sha256").update(s.f.data).digest("hex"), storageKey: s.key, scanStatus: await initialScanStatus(tx) },
        });
      }
      await tx.ticketHistory.create({ data: { ticketId, actorId: actor.id, action: "ATTACHMENT_ADDED", newValue: stored.map((s) => s.f.safeName).join(", ") } });
      await audit(tx, actor, { action: "ATTACHMENT_ADDED", entityType: "Ticket", entityId: ticketId, ticketId, newValue: stored.map((s) => s.f.safeName) });
    });
  } catch (e) {
    await Promise.allSettled(stored.map((s) => storage.delete(s.key)));
    throw e;
  }
}

export async function removeTicketAttachment(actor: Actor, attachmentId: string) {
  const att = await prisma.ticketAttachment.findFirst({ where: { id: attachmentId, deletedAt: null } });
  if (!att) throw new NotFoundError();
  const ticket = await loadTicketForMutation(actor, att.ticketId);
  const own = att.uploadedById === actor.id;
  if (!(own || canWorkTicket(actor, ticket))) throw new AuthorizationError();
  if (["CLOSED", "CANCELLED"].includes(ticket.status.kind) && !can(actor, P.TICKET_CLOSED_EDIT)) {
    throw new ValidationError("Closed tickets cannot be modified.");
  }
  await transaction(async (tx) => {
    await tx.ticketAttachment.update({ where: { id: att.id }, data: { deletedAt: new Date() } });
    await tx.ticketHistory.create({ data: { ticketId: ticket.id, actorId: actor.id, action: "ATTACHMENT_REMOVED", oldValue: att.fileName } });
    await audit(tx, actor, { action: "ATTACHMENT_REMOVED", entityType: "TicketAttachment", entityId: att.id, ticketId: ticket.id, oldValue: { fileName: att.fileName } });
  });
}

/** Returns attachment + bytes only if the actor can read the parent ticket (and message, if internal). */
export async function readAttachment(actor: Actor, attachmentId: string) {
  const att = await prisma.ticketAttachment.findFirst({
    where: { id: attachmentId, deletedAt: null, ticket: ticketScopeWhere(actor) },
    include: { message: { select: { type: true } } },
  });
  if (!att) throw new NotFoundError();
  if (att.message?.type === "INTERNAL" && (!can(actor, P.NOTE_INTERNAL_READ) || isVendor(actor))) throw new NotFoundError();
  if (att.taskId) {
    const visible = await prisma.ticketTask.count({ where: { AND: [taskScopeWhere(actor), { id: att.taskId }] } });
    if (!visible) throw new NotFoundError();
  }
  // Malware-scan gate (attachments.malwareScan): pending files are re-checked on demand.
  const status = att.scanStatus === "PENDING" ? await refreshScan(att) : att.scanStatus;
  const decision = downloadDecision(status);
  if (decision === "blocked") throw new AttachmentBlockedError();
  if (decision === "pending") throw new AttachmentScanPendingError();
  const storage = await getStorage();
  return { att, data: await storage.get(att.storageKey) };
}

// ───────────────────────────── Create-form options ─────────────────────────────

export async function getCreateTicketOptions(actor: Actor, locale: Locale = DEFAULT_LOCALE) {
  const [categories, priorities, branches, settings] = await Promise.all([
    prisma.category.findMany({
      where: { parentId: null, isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, nameTh: true, requiredFields: true, defaultPriorityId: true,
        children: {
          where: { isActive: true, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true, nameTh: true, requiredFields: true, defaultPriorityId: true },
        },
      },
    }),
    prisma.priority.findMany({ where: { isActive: true }, orderBy: { level: "asc" } }),
    prisma.branch.findMany({
      where: { isActive: true, deletedAt: null, ...(actor.companyId ? { companyId: actor.companyId } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, nameTh: true, locations: { where: { isActive: true, deletedAt: null }, select: { id: true, name: true, nameTh: true }, orderBy: { name: "asc" } } },
    }),
    getSettings(prisma),
  ]);
  return {
    // Names are localized here so client components can render them directly.
    categories: categories.map((c) => ({ ...c, name: ln(c, locale), requiredFields: c.requiredFields as string[],
      children: c.children.map((s) => ({ ...s, name: ln(s, locale), requiredFields: s.requiredFields as string[] })) })),
    priorities: priorities.map((p) => ({ ...p, name: ln(p, locale) })),
    branches: branches.map((b) => ({ ...b, name: ln(b, locale), locations: b.locations.map((l) => ({ ...l, name: ln(l, locale) })) })),
    canSetPriority: settings["tickets.requesterCanSetPriority"] || can(actor, P.TICKET_UPDATE),
    maxFileSizeMb: settings["attachments.maxFileSizeMb"],
    maxFiles: settings["attachments.maxFilesPerUpload"],
    allowedExtensions: settings["attachments.allowedExtensions"],
  };
}

export function statusKindLabel(kind: StatusKind) {
  return kind.charAt(0) + kind.slice(1).toLowerCase();
}

export type TimelineCategory = "status" | "assignment" | "tasks" | "fields" | "attachments" | "other";

export function timelineCategory(action: string): TimelineCategory {
  if (action === "STATUS_CHANGED" || action === "REOPENED" || action === "CREATED") return "status";
  if (["AGENT_CHANGED", "TEAM_CHANGED", "ESCALATED", "SUPPORTING_TEAM_ADDED", "SUPPORTING_TEAM_REMOVED"].includes(action)) return "assignment";
  if (action.startsWith("TASK_")) return "tasks";
  if (action === "FIELD_UPDATED" || action === "CATEGORY_CHANGED" || action === "PRIORITY_CHANGED") return "fields";
  if (action.startsWith("ATTACHMENT_")) return "attachments";
  return "other";
}
