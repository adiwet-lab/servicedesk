import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { requirePermission } from "@/server/authz/guards";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { messageScopeWhere, ticketScopeWhere, UNCLAIMED_CHAT } from "@/server/authz/scope";
import { queueEvent, rooms } from "@/server/realtime/bus";
import type { UploadCandidate } from "@/server/storage/validate";
import { ln } from "@/lib/localized";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { commitAssignment, createTicket, getCreateTicketOptions, loadTicketForMutation } from "./tickets";
import { unreadCounts } from "./messages";
import { notifyUsers } from "./notifications";

/**
 * Chat-first service (Phase 9). A chat case IS a ticket (channel = CHAT): the guided chat collects
 * category → subcategory → branch → details, then creates the ticket through createTicket, so routing,
 * SLA, approvals and notifications behave exactly as for the form. The conversation is the ticket chat.
 */

const CLOSED_KINDS = ["CLOSED", "CANCELLED"] as const;

// ───────────────────────────── Employee side ─────────────────────────────

/** Options for the guided "new case" flow: categories (localized) and branches, the user's branch first. */
export async function chatStartOptions(actor: Actor, locale: Locale = DEFAULT_LOCALE) {
  const o = await getCreateTicketOptions(actor, locale);
  const branches = [...o.branches].sort((a, b) => (a.id === actor.branchId ? -1 : b.id === actor.branchId ? 1 : 0));
  return {
    categories: o.categories.map((c) => ({ id: c.id, name: c.name, requiredFields: c.requiredFields,
      children: c.children.map((s) => ({ id: s.id, name: s.name, requiredFields: s.requiredFields })) })),
    branches: branches.map((b) => ({ id: b.id, name: b.name })),
    myBranchId: actor.branchId,
    maxFileSizeMb: o.maxFileSizeMb, maxFiles: o.maxFiles, allowedExtensions: o.allowedExtensions,
  };
}

/** Subject for a chat case: first line of the details (≤ 80 chars), else the subcategory/category name. */
export function chatSubject(body: string, fallback: string): string {
  const line = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const s = line.length > 80 ? `${line.slice(0, 77).trimEnd()}…` : line;
  return s.length >= 5 ? s : `${fallback}${s ? `: ${s}` : ""}`.slice(0, 200);
}

const startSchema = z.object({
  categoryId: z.string().min(1).max(50),
  subcategoryId: z.string().max(50).optional(),
  branchId: z.string().max(50).optional(),
  body: z.string().trim().max(20000).default(""),
  extra: z.record(z.string().max(40), z.string().max(500)).default({}),
});

export async function startChatCase(actor: Actor, raw: unknown, files: UploadCandidate[] = []) {
  const input = startSchema.parse(raw);
  const cat = await prisma.category.findFirst({ where: { id: input.subcategoryId || input.categoryId }, select: { name: true } });
  if (!cat) throw new ValidationError("Invalid category.", { categoryId: "Select a valid main category" });
  // Files alone are a valid first message; the ticket still needs a description.
  const description = input.body || (files.length ? `(${files.map((f) => f.name).join(", ")})` : "");
  const allowed = ["contactNumber", "relatedAsset", "affectedSystem", "affectedUsers", "locationId"] as const;
  const extra = Object.fromEntries(allowed.filter((k) => input.extra[k]).map((k) => [k, input.extra[k]]));
  return createTicket(actor, {
    subject: chatSubject(input.body, cat.name), description,
    categoryId: input.categoryId, subcategoryId: input.subcategoryId || undefined, branchId: input.branchId || undefined, ...extra,
  }, files, { channel: "CHAT" });
}

/** The requester's open cases (any channel) to follow up, newest activity first. */
export async function followUpList(actor: Actor, locale: Locale = DEFAULT_LOCALE) {
  const rows = await prisma.ticket.findMany({
    where: { AND: [ticketScopeWhere(actor), { requesterId: actor.id, status: { kind: { notIn: [...CLOSED_KINDS] } } }] },
    orderBy: { updatedAt: "desc" }, take: 50,
    select: {
      id: true, number: true, subject: true, channel: true, updatedAt: true,
      status: { select: { name: true, nameTh: true, color: true, kind: true } },
      messages: { where: messageScopeWhere(actor), orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true } },
    },
  });
  const unread = await unreadCounts(actor, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, number: r.number, subject: r.subject, channel: r.channel,
    status: { name: ln(r.status, locale), color: r.status.color, kind: r.status.kind },
    lastAt: r.messages[0]?.createdAt ?? r.updatedAt, preview: r.messages[0]?.body.slice(0, 120) ?? "", unread: unread[r.id] ?? 0,
  }));
}

/** Header data for one conversation (requester or staff), within the actor's scope. */
export async function chatCaseHeader(actor: Actor, ticketId: string, locale: Locale = DEFAULT_LOCALE) {
  const t = await prisma.ticket.findFirst({
    where: { AND: [ticketScopeWhere(actor), { OR: [{ id: ticketId }, { number: ticketId }] }] },
    select: {
      id: true, number: true, subject: true, channel: true, requesterId: true, createdAt: true, statusId: true, ownerTeamId: true, assignedAgentId: true,
      approvalStatus: true,
      status: { select: { name: true, nameTh: true, color: true, kind: true } },
      category: { select: { name: true, nameTh: true } }, subcategory: { select: { name: true, nameTh: true } },
      branch: { select: { name: true, nameTh: true } }, ownerTeam: { select: { name: true, nameTh: true } },
      assignedAgent: { select: { displayName: true } }, requester: { select: { displayName: true, email: true, jobTitle: true, contactNumber: true } },
    },
  });
  if (!t) throw new NotFoundError("Ticket not found or you do not have access.");
  return {
    ...t,
    status: { ...t.status, name: ln(t.status, locale) },
    category: `${ln(t.category, locale)}${t.subcategory ? ` › ${ln(t.subcategory, locale)}` : ""}`,
    branch: t.branch ? ln(t.branch, locale) : null,
    ownerTeam: t.ownerTeam ? ln(t.ownerTeam, locale) : null,
    unclaimed: t.channel === "CHAT" && !t.assignedAgentId,
  };
}

// ───────────────────────────── Staff side ─────────────────────────────

export const CHAT_VIEWS = ["unclaimed", "mine", "myTeams", "all"] as const;
export type ChatView = (typeof CHAT_VIEWS)[number];

const ids = z.array(z.string().min(1).max(50)).max(100).default([]);
export const chatFilterSchema = z.object({
  view: z.enum(CHAT_VIEWS).default("unclaimed"),
  categoryIds: ids,
  statusIds: ids,
  teamIds: ids,
  branchIds: ids,
  /** Hide closed / cancelled conversations. */
  openOnly: z.boolean().default(true),
  /** Also list conversations of tickets created with the form. */
  includeForm: z.boolean().default(false),
});
export type ChatFilter = z.infer<typeof chatFilterSchema>;
export const DEFAULT_CHAT_FILTER: ChatFilter = chatFilterSchema.parse({});

const FILTER_KEY = "chat.filter";

function requireQueue(actor: Actor) {
  requirePermission(actor, P.CHAT_QUEUE);
  if (isVendor(actor)) throw new AuthorizationError();
}

export async function getChatFilter(actor: Actor): Promise<ChatFilter> {
  const row = await prisma.userPreference.findUnique({ where: { userId_key: { userId: actor.id, key: FILTER_KEY } } });
  const p = chatFilterSchema.safeParse(row?.value ?? {});
  return p.success ? p.data : DEFAULT_CHAT_FILTER;
}

export async function saveChatFilter(actor: Actor, raw: unknown): Promise<ChatFilter> {
  requireQueue(actor);
  const f = chatFilterSchema.parse(raw);
  await prisma.userPreference.upsert({
    where: { userId_key: { userId: actor.id, key: FILTER_KEY } },
    update: { value: f as Prisma.InputJsonValue }, create: { userId: actor.id, key: FILTER_KEY, value: f as Prisma.InputJsonValue },
  });
  return f;
}

/** Filter → where clause (dimensions only; the view is applied separately). */
function filterWhere(f: ChatFilter): Prisma.TicketWhereInput[] {
  const and: Prisma.TicketWhereInput[] = [];
  if (f.categoryIds.length) and.push({ OR: [{ categoryId: { in: f.categoryIds } }, { subcategoryId: { in: f.categoryIds } }] });
  if (f.statusIds.length) and.push({ statusId: { in: f.statusIds } });
  if (f.teamIds.length) and.push({ ownerTeamId: { in: f.teamIds } });
  if (f.branchIds.length) and.push({ branchId: { in: f.branchIds } });
  if (f.openOnly) and.push({ status: { kind: { notIn: [...CLOSED_KINDS] } } });
  return and;
}

function viewWhere(actor: Actor, view: ChatView): Prisma.TicketWhereInput {
  switch (view) {
    case "unclaimed": return UNCLAIMED_CHAT;
    case "mine": return { assignedAgentId: actor.id };
    case "myTeams": return { ownerTeamId: { in: actor.teamIds } };
    default: return {};
  }
}

export interface ChatQueueRow {
  ticketId: string; number: string; subject: string; channel: "FORM" | "CHAT";
  status: { name: string; color: string; kind: string }; category: string; branch: string | null; team: string | null;
  requester: string; agent: string | null; unclaimed: boolean; createdAt: Date;
  lastAt: Date; lastSender: string | null; preview: string; unread: number;
}

/** Conversations for the staff console. Unclaimed: oldest first (FIFO); other views: latest activity first. */
export async function chatQueue(actor: Actor, raw: unknown, opts: { q?: string; locale?: Locale } = {}) {
  requireQueue(actor);
  const f = chatFilterSchema.parse(raw);
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const q = opts.q?.trim().slice(0, 200);
  const where: Prisma.TicketWhereInput = {
    AND: [
      ticketScopeWhere(actor),
      viewWhere(actor, f.view),
      f.includeForm || f.view === "unclaimed" ? {} : { channel: "CHAT" },
      f.includeForm && f.view !== "unclaimed" ? { OR: [{ channel: "CHAT" }, { messages: { some: {} } }] } : {},
      ...filterWhere(f),
      q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { subject: { contains: q, mode: "insensitive" } }, { requester: { displayName: { contains: q, mode: "insensitive" } } }] } : {},
    ],
  };
  const msgScope = messageScopeWhere(actor);
  const rows = await prisma.ticket.findMany({
    where, take: 300, orderBy: { updatedAt: "desc" },
    select: {
      id: true, number: true, subject: true, channel: true, createdAt: true, updatedAt: true, assignedAgentId: true,
      status: { select: { name: true, nameTh: true, color: true, kind: true } },
      category: { select: { name: true, nameTh: true } }, subcategory: { select: { name: true, nameTh: true } },
      branch: { select: { name: true, nameTh: true } }, ownerTeam: { select: { name: true, nameTh: true } },
      requester: { select: { displayName: true } }, assignedAgent: { select: { displayName: true } },
      messages: { where: msgScope, orderBy: { createdAt: "desc" }, take: 1,
        select: { body: true, createdAt: true, sender: { select: { displayName: true } }, attachments: { select: { fileName: true } } } },
    },
  });
  const unread = await unreadCounts(actor, rows.map((r) => r.id));
  const out: ChatQueueRow[] = rows.map((r) => {
    const m = r.messages[0];
    return {
      ticketId: r.id, number: r.number, subject: r.subject, channel: r.channel,
      status: { name: ln(r.status, locale), color: r.status.color, kind: r.status.kind },
      category: `${ln(r.category, locale)}${r.subcategory ? ` › ${ln(r.subcategory, locale)}` : ""}`,
      branch: r.branch ? ln(r.branch, locale) : null, team: r.ownerTeam ? ln(r.ownerTeam, locale) : null,
      requester: r.requester.displayName, agent: r.assignedAgent?.displayName ?? null,
      unclaimed: r.channel === "CHAT" && !r.assignedAgentId && !CLOSED_KINDS.includes(r.status.kind as never),
      createdAt: r.createdAt, lastAt: m?.createdAt ?? r.updatedAt, lastSender: m?.sender.displayName ?? null,
      preview: m ? (m.body ? m.body.slice(0, 140) : `📎 ${m.attachments.map((a) => a.fileName).join(", ")}`) : "",
      unread: unread[r.id] ?? 0,
    };
  });
  out.sort((a, b) => (f.view === "unclaimed" ? a.createdAt.getTime() - b.createdAt.getTime() : b.lastAt.getTime() - a.lastAt.getTime()));
  return { rows: out, filter: f };
}

/** Unclaimed chats matching the actor's saved filter (nav badge). */
export async function unclaimedChatCount(actor: Actor): Promise<number> {
  if (isVendor(actor) || !actor.permissions.has(P.CHAT_QUEUE)) return 0;
  const f = await getChatFilter(actor);
  return prisma.ticket.count({ where: { AND: [ticketScopeWhere(actor), UNCLAIMED_CHAT, ...filterWhere({ ...f, statusIds: f.statusIds })] } });
}

/** Filter choices for the console (localized). */
export async function chatFilterOptions(actor: Actor, locale: Locale = DEFAULT_LOCALE) {
  requireQueue(actor);
  const [categories, statuses, teams, branches] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, nameTh: true, parentId: true } }),
    prisma.ticketStatus.findMany({ where: { isActive: true }, orderBy: { order: "asc" }, select: { id: true, name: true, nameTh: true, kind: true } }),
    prisma.supportTeam.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, nameTh: true, type: true } }),
    prisma.branch.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, nameTh: true } }),
  ]);
  const main = categories.filter((c) => !c.parentId);
  return {
    categories: main.map((c) => ({ id: c.id, name: ln(c, locale),
      children: categories.filter((s) => s.parentId === c.id).map((s) => ({ id: s.id, name: ln(s, locale) })) })),
    statuses: statuses.map((s) => ({ id: s.id, name: ln(s, locale), kind: s.kind })),
    teams: teams.map((t) => ({ id: t.id, name: ln(t, locale), type: t.type })),
    branches: branches.map((b) => ({ id: b.id, name: ln(b, locale) })),
    myTeamIds: actor.teamIds,
  };
}

/**
 * Claims an unclaimed chat for the actor. Team: the chosen one (must be the actor's), else the current owner team
 * if the actor belongs to it, else the actor's only team. Atomic: a second claim fails with a clear message.
 */
export async function claimChat(actor: Actor, ticketId: string, teamId?: string) {
  requireQueue(actor);
  const ticket = await loadTicketForMutation(actor, ticketId).catch(async (e) => {
    // Once claimed by another team the chat leaves this actor's view: say so instead of "not found".
    const claimed = await prisma.ticket.count({ where: { id: ticketId, channel: "CHAT", assignedAgentId: { not: null }, deletedAt: null } });
    if (claimed) throw new ValidationError("This chat has already been claimed by someone else.");
    throw e;
  });
  if (ticket.channel !== "CHAT") throw new ValidationError("Only chat cases can be claimed.");
  if (ticket.assignedAgentId) throw new ValidationError("This chat has already been claimed by someone else.");
  if (CLOSED_KINDS.includes(ticket.status.kind as never)) throw new ValidationError("Closed tickets cannot be reassigned.");
  const memberTeams = await prisma.teamMember.findMany({
    where: { userId: actor.id, team: { isActive: true, deletedAt: null } }, select: { team: { select: { id: true, name: true, nameTh: true } } },
  });
  const mine = memberTeams.map((m) => m.team);
  let team = teamId ? mine.find((t) => t.id === teamId) : mine.find((t) => t.id === ticket.ownerTeamId) ?? (mine.length === 1 ? mine[0] : undefined);
  if (teamId && !team) throw new ValidationError("Not an active member of the team");
  if (!team) {
    if (!mine.length) throw new ValidationError("You are not a member of any support team.");
    throw new ValidationError("Choose the team that takes this chat.", { teamId: "Choose the team that takes this chat." });
  }
  team = team!;
  await commitAssignment(actor, ticket, {
    team, newAgentId: actor.id, onlyIfUnclaimed: true,
    reason: team.id === ticket.ownerTeamId ? undefined : "Claimed from chat",
  });
  await notifyUsers(prisma, [ticket.requesterId], {
    type: "TICKET_ASSIGNED", key: "chatClaimed", params: { number: ticket.number, agent: actor.displayName, subject: ticket.subject },
    title: `${actor.displayName} is handling ${ticket.number}`, body: ticket.subject, ticketId: ticket.id, link: `/chat?t=${ticket.number}`,
  }, actor);
  queueEvent(null, { room: rooms.chatQueue, event: "chat:claimed", payload: { ticketId: ticket.id } });
  return { ticketId: ticket.id, number: ticket.number, teamId: team.id };
}

/** Signal the queue that a conversation changed (status, team, category …). */
export function signalChatUpdated(ticketId: string) {
  queueEvent(null, { room: rooms.chatQueue, event: "chat:updated", payload: { ticketId } });
}
