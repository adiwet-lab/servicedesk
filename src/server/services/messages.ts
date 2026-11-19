import { initialScanStatus } from "@/server/storage/malware-scan";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { Prisma, type MessageType } from "@prisma/client";
import { prisma } from "@/server/db";
import { transaction } from "@/server/db-tx";
import type { Actor } from "@/server/authz/actor";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { canPostInternalNote, canPostPublicMessage, canReadInternalNotes, type ChatTicketContext } from "@/server/authz/messages";
import { canWorkTicket, messageScopeWhere, taskScopeWhere, ticketScopeWhere } from "@/server/authz/scope";
import { queueEvent, rooms } from "@/server/realtime/bus";
import { enforceRateLimit } from "@/server/ratelimit";
import { getStorage } from "@/server/storage/provider";
import { validateUploads, type UploadCandidate } from "@/server/storage/validate";
import { audit } from "./audit";
import { notifyUsers, teamMemberIds } from "./notifications";
import { getSettings } from "./settings";
import { applyStatusChange, recordFirstResponse, ticketSlaSelect } from "./sla";

const postSchema = z.object({
  type: z.enum(["PUBLIC", "INTERNAL"]).default("PUBLIC"),
  body: z.string().max(10_000, "Message is too long (max 10,000 characters)").default(""),
});

// ───────────────────────────── Context ─────────────────────────────

/** Loads a ticket the actor can see plus the context needed for chat permissions. */
async function loadChatTicket(actor: Actor, ticketId: string) {
  const ticket = await prisma.ticket.findFirst({
    where: { AND: [ticketScopeWhere(actor), { OR: [{ id: ticketId }, { number: ticketId }] }] },
    select: {
      number: true, subject: true, requesterId: true, ownerTeamId: true, assignedAgentId: true, statusId: true,
      status: { select: { kind: true, pausesSla: true, name: true } }, ...ticketSlaSelect,
    },
  });
  if (!ticket) throw new NotFoundError("Ticket not found or you do not have access.");
  const tasks = await prisma.ticketTask.findMany({
    where: { AND: [taskScopeWhere(actor), { ticketId: ticket.id, status: { notIn: ["COMPLETED", "CANCELLED"] } }] },
    select: { teamId: true, assignedAgentId: true },
  });
  const ctx: ChatTicketContext = {
    requesterId: ticket.requesterId, ownerTeamId: ticket.ownerTeamId, assignedAgentId: ticket.assignedAgentId,
    statusKind: ticket.status.kind, tasks,
  };
  return { ticket, ctx };
}

export async function getChatPermissions(actor: Actor, ticketId: string) {
  const { ticket, ctx } = await loadChatTicket(actor, ticketId);
  return {
    ticketId: ticket.id,
    canPostPublic: canPostPublicMessage(actor, ctx),
    canPostInternal: canPostInternalNote(actor, ctx),
    canReadInternal: canReadInternalNotes(actor),
    closed: ctx.statusKind === "CLOSED" || ctx.statusKind === "CANCELLED",
  };
}

// ───────────────────────────── Read ─────────────────────────────

const messageInclude = {
  sender: { select: { id: true, displayName: true, tenant: { select: { type: true } }, teamMemberships: { select: { teamId: true }, take: 1 } } },
  attachments: { where: { deletedAt: null }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
  reads: { select: { userId: true, readAt: true, user: { select: { displayName: true } } } },
} satisfies Prisma.TicketMessageInclude;

type RawMessage = Prisma.TicketMessageGetPayload<{ include: typeof messageInclude }>;

export interface ChatMessageDto {
  id: string;
  type: MessageType;
  body: string;
  createdAt: Date;
  mine: boolean;
  sender: { id: string; name: string; role: "Requester" | "Support" | "External support" | "User" };
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number; image: boolean }[];
  /** For my messages only: other participants who have read it. */
  seenBy: string[];
  unread: boolean;
}

function toDto(actor: Actor, requesterId: string, m: RawMessage): ChatMessageDto {
  const role = m.senderId === requesterId ? "Requester"
    : m.sender.tenant.type === "VENDOR" ? "External support"
    : m.sender.teamMemberships.length ? "Support" : "User";
  return {
    id: m.id, type: m.type, body: m.body, createdAt: m.createdAt, mine: m.senderId === actor.id,
    sender: { id: m.senderId, name: m.sender.displayName, role },
    attachments: m.attachments.map((a) => ({ ...a, image: a.mimeType === "image/png" || a.mimeType === "image/jpeg" })),
    seenBy: m.senderId === actor.id ? m.reads.filter((r) => r.userId !== actor.id).map((r) => r.user.displayName) : [],
    unread: m.senderId !== actor.id && !m.reads.some((r) => r.userId === actor.id),
  };
}

/**
 * Messages visible to the actor (internal notes filtered in the query),
 * newest page first; `before`/`after` are message ids for paging / live append.
 */
export async function listMessages(actor: Actor, ticketId: string, opts: { before?: string; after?: string; q?: string; limit?: number } = {}) {
  const { ticket } = await loadChatTicket(actor, ticketId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const where: Prisma.TicketMessageWhereInput[] = [messageScopeWhere(actor), { ticketId: ticket.id }];
  if (opts.q?.trim()) where.push({ body: { contains: opts.q.trim().slice(0, 200), mode: "insensitive" } });
  const pivotId = opts.before ?? opts.after;
  if (pivotId) {
    const pivot = await prisma.ticketMessage.findFirst({ where: { id: pivotId, ticketId: ticket.id }, select: { createdAt: true, id: true } });
    if (pivot) {
      where.push(opts.before
        ? { OR: [{ createdAt: { lt: pivot.createdAt } }, { createdAt: pivot.createdAt, id: { lt: pivot.id } }] }
        : { OR: [{ createdAt: { gt: pivot.createdAt } }, { createdAt: pivot.createdAt, id: { gt: pivot.id } }] });
    }
  }
  const rows = await prisma.ticketMessage.findMany({
    where: { AND: where }, include: messageInclude,
    orderBy: opts.after ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const ordered = opts.after ? page : page.reverse();
  return { ticketId: ticket.id, messages: ordered.map((m) => toDto(actor, ticket.requesterId, m)), hasMore: opts.after ? false : hasMore };
}

// ───────────────────────────── Post ─────────────────────────────

export async function postMessage(actor: Actor, ticketId: string, raw: unknown, files: UploadCandidate[] = []) {
  await enforceRateLimit(`chat:${actor.id}`, 30, 60_000);
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid message");
  const { type } = parsed.data;
  const body = parsed.data.body.replace(/\r\n/g, "\n").trim();
  if (!body && files.length === 0) throw new ValidationError("Write a message or attach a file.");

  const { ticket, ctx } = await loadChatTicket(actor, ticketId);
  const allowed = type === "INTERNAL" ? canPostInternalNote(actor, ctx) : canPostPublicMessage(actor, ctx);
  if (!allowed) {
    if (ctx.statusKind === "CLOSED" || ctx.statusKind === "CANCELLED") throw new ValidationError("This ticket is closed. Reopen it to continue the conversation.");
    throw new AuthorizationError(type === "INTERNAL" ? "You cannot write internal notes." : "You are not a participant of this ticket's conversation.");
  }

  const settings = await getSettings(prisma);
  let uploads: Extract<ReturnType<typeof validateUploads>, { ok: true }>["files"] = [];
  if (files.length) {
    const v = validateUploads(files, {
      maxFileSizeMb: settings["attachments.maxFileSizeMb"], maxFiles: settings["attachments.maxFilesPerUpload"],
      allowedExtensions: settings["attachments.allowedExtensions"],
    });
    if ("error" in v) throw new ValidationError(v.error);
    uploads = v.files;
  }

  const isRequester = ticket.requesterId === actor.id;
  const isStaff = !isRequester && (canWorkTicket(actor, ctx) || ctx.tasks.length > 0 || actor.teamIds.length > 0);
  // Requester reply resumes a WAITING ticket (configurable; only if the workflow allows that transition).
  let resume: { id: string; name: string; code: string; kind: "NEW" | "OPEN" | "WAITING" | "RESOLVED" | "CLOSED" | "CANCELLED"; pausesSla: boolean } | null = null;
  const resumeCode = settings["workflow.requesterReplyStatusCode"];
  if (type === "PUBLIC" && isRequester && ticket.status.kind === "WAITING" && resumeCode) {
    const target = await prisma.ticketStatus.findFirst({ where: { code: resumeCode, isActive: true } });
    if (target && target.id !== ticket.statusId) {
      const tr = await prisma.workflowTransition.findUnique({ where: { fromStatusId_toStatusId: { fromStatusId: ticket.statusId, toStatusId: target.id } } });
      if (tr) resume = target;
    }
  }

  const storage = await getStorage();
  const stored: { key: string; f: (typeof uploads)[number] }[] = [];
  try {
    for (const f of uploads) {
      const key = `messages/${new Date().getFullYear()}/${randomUUID()}`;
      await storage.put(key, f.data, f.mime);
      stored.push({ key, f });
    }
    const now = new Date();
    const message = await transaction(async (tx) => {
      const m = await tx.ticketMessage.create({ data: { ticketId: ticket.id, senderId: actor.id, type, body } });
      for (const s of stored) {
        await tx.ticketAttachment.create({
          data: { ticketId: ticket.id, messageId: m.id, uploadedById: actor.id, fileName: s.f.safeName, mimeType: s.f.mime, sizeBytes: s.f.size,
            sha256: createHash("sha256").update(s.f.data).digest("hex"), storageKey: s.key, scanStatus: await initialScanStatus(tx) },
        });
      }
      await tx.messageRead.create({ data: { messageId: m.id, userId: actor.id } });

      if (type === "PUBLIC" && isStaff && !ticket.firstResponseAt) {
        await tx.ticket.update({ where: { id: ticket.id }, data: { ...(await recordFirstResponse(tx, ticket, now)), updatedAt: now } });
        await tx.ticketHistory.create({ data: { ticketId: ticket.id, actorId: actor.id, action: "FIRST_RESPONSE", newValue: "First response via chat" } });
      } else {
        await tx.ticket.update({ where: { id: ticket.id }, data: { updatedAt: now } });
      }
      if (resume) {
        const moved = await tx.ticket.updateMany({
          where: { id: ticket.id, statusId: ticket.statusId },
          data: { statusId: resume.id, waitingReason: null },
        });
        if (moved.count === 1) {
          const slaData = await applyStatusChange(tx, ticket, resume, now);
          if (Object.keys(slaData).length) await tx.ticket.update({ where: { id: ticket.id }, data: slaData });
          await tx.ticketHistory.create({ data: { ticketId: ticket.id, actorId: actor.id, action: "STATUS_CHANGED", field: "status", oldValue: ticket.status.name, newValue: resume.name, reason: "Auto on requester reply" } });
          await audit(tx, actor, { action: "STATUS_CHANGED", entityType: "Ticket", entityId: ticket.id, ticketId: ticket.id, oldValue: { status: ticket.status.name }, newValue: { status: resume.name, reason: "Requester reply" } });
        }
      }

      await audit(tx, actor, {
        action: type === "INTERNAL" ? "INTERNAL_NOTE" : "CHAT_MESSAGE", entityType: "TicketMessage", entityId: m.id, ticketId: ticket.id,
        newValue: { type, length: body.length, excerpt: body.slice(0, 200), attachments: stored.map((s) => s.f.safeName) },
      });
      if (stored.length) {
        await audit(tx, actor, { action: "ATTACHMENT_ADDED", entityType: "TicketMessage", entityId: m.id, ticketId: ticket.id, newValue: { type, files: stored.map((s) => s.f.safeName) } });
      }

      // Recipients
      const activeTaskAgents = (await tx.ticketTask.findMany({
        where: { ticketId: ticket.id, status: { notIn: ["COMPLETED", "CANCELLED"] }, assignedAgentId: { not: null } }, select: { assignedAgentId: true },
      })).map((t) => t.assignedAgentId);
      let recipients: (string | null)[];
      if (type === "INTERNAL") {
        recipients = [ticket.assignedAgentId, ...activeTaskAgents];
        // Never notify external users about internal notes.
        const internalUsers = await tx.user.findMany({ where: { id: { in: recipients.filter(Boolean) as string[] }, tenant: { type: "INTERNAL" } }, select: { id: true } });
        recipients = internalUsers.map((u) => u.id);
      } else if (isRequester) {
        recipients = ticket.assignedAgentId ? [ticket.assignedAgentId, ...activeTaskAgents] : [...(await teamMemberIds(tx, ticket.ownerTeamId)), ...activeTaskAgents];
      } else {
        recipients = [ticket.requesterId, ticket.assignedAgentId];
      }
      const excerpt = body ? body.slice(0, 140) : `📎 ${stored.map((s) => s.f.safeName).join(", ")}`;
      await notifyUsers(tx, recipients, {
        type: "NEW_MESSAGE",
        title: `${type === "INTERNAL" ? "Internal note" : "New message"} on ${ticket.number} from ${actor.displayName}`,
        body: excerpt, ticketId: ticket.id,
        link: isRequester || type === "INTERNAL" ? `/admin/tickets/${ticket.number}?tab=chat` : `/tickets/${ticket.number}?tab=chat`,
      }, actor);

      queueEvent(tx, {
        room: type === "INTERNAL" ? rooms.ticketInternal(ticket.id) : rooms.ticket(ticket.id),
        event: "message:new", payload: { ticketId: ticket.id, messageId: m.id },
      });
      return m;
    });
    return { id: message.id };
  } catch (e) {
    await Promise.allSettled(stored.map((s) => storage.delete(s.key)));
    throw e;
  }
}

// ───────────────────────────── Read status ─────────────────────────────

/** Marks every visible message of the ticket as read by the actor (and its chat notifications). */
export async function markTicketRead(actor: Actor, ticketId: string) {
  const { ticket } = await loadChatTicket(actor, ticketId);
  const unread = await prisma.ticketMessage.findMany({
    where: { AND: [messageScopeWhere(actor), { ticketId: ticket.id, senderId: { not: actor.id }, reads: { none: { userId: actor.id } } }] },
    select: { id: true, type: true },
  });
  if (unread.length === 0) return { marked: 0 };
  await transaction(async (tx) => {
    await tx.messageRead.createMany({ data: unread.map((m) => ({ messageId: m.id, userId: actor.id })), skipDuplicates: true });
    await tx.notification.updateMany({ where: { userId: actor.id, ticketId: ticket.id, type: "NEW_MESSAGE", readAt: null }, data: { readAt: new Date() } });
    queueEvent(tx, { room: rooms.ticket(ticket.id), event: "message:read", payload: { ticketId: ticket.id } });
    queueEvent(tx, { room: rooms.user(actor.id), event: "notify:read", payload: {} });
  });
  return { marked: unread.length };
}

/** SQL fragment: visible-message predicate for raw aggregate queries. */
function internalFilterSql(actor: Actor) {
  return canReadInternalNotes(actor) ? Prisma.empty : Prisma.sql`AND m."type" = 'PUBLIC'`;
}

/** Unread message counts per ticket for the actor (only tickets the actor can see). */
export async function unreadCounts(actor: Actor, ticketIds: string[]): Promise<Record<string, number>> {
  if (ticketIds.length === 0) return {};
  const visible = await prisma.ticket.findMany({ where: { AND: [ticketScopeWhere(actor), { id: { in: ticketIds } }] }, select: { id: true } });
  if (visible.length === 0) return {};
  const rows = await prisma.$queryRaw<{ ticketId: string; n: bigint }[]>`
    SELECT m."ticketId", COUNT(*)::bigint AS n
      FROM "TicketMessage" m
     WHERE m."ticketId" IN (${Prisma.join(visible.map((v) => v.id))})
       AND m."deletedAt" IS NULL
       AND m."senderId" <> ${actor.id}
       ${internalFilterSql(actor)}
       AND NOT EXISTS (SELECT 1 FROM "MessageRead" r WHERE r."messageId" = m.id AND r."userId" = ${actor.id})
     GROUP BY m."ticketId"`;
  return Object.fromEntries(rows.map((r) => [r.ticketId, Number(r.n)]));
}

// ───────────────────────────── Inbox ─────────────────────────────

export interface InboxRow {
  ticketId: string;
  number: string;
  subject: string;
  statusName: string;
  statusColor: string;
  requester: string;
  lastAt: Date;
  lastSender: string;
  lastType: MessageType;
  preview: string;
  unread: number;
  matchCount?: number;
}

/**
 * Conversations the actor can see, ordered by latest visible message.
 * `q` searches visible message bodies and ticket number/subject.
 */
export async function chatInbox(actor: Actor, opts: { q?: string; unreadOnly?: boolean; page?: number; mineOnly?: boolean } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const take = 25;
  const q = opts.q?.trim().slice(0, 200);
  const msgScope = messageScopeWhere(actor);
  const where: Prisma.TicketWhereInput = {
    AND: [
      ticketScopeWhere(actor),
      opts.mineOnly ? { requesterId: actor.id } : {},
      { messages: { some: msgScope } },
      q ? { OR: [
        { number: { contains: q, mode: "insensitive" } }, { subject: { contains: q, mode: "insensitive" } },
        { messages: { some: { AND: [msgScope, { body: { contains: q, mode: "insensitive" } }] } } },
      ] } : {},
    ],
  };
  // Candidate tickets (bounded), then order by last visible message.
  const tickets = await prisma.ticket.findMany({
    where, take: 500, orderBy: { updatedAt: "desc" },
    select: {
      id: true, number: true, subject: true, status: { select: { name: true, color: true } }, requester: { select: { displayName: true } },
      messages: { where: msgScope, orderBy: { createdAt: "desc" }, take: 1, select: { body: true, type: true, createdAt: true, sender: { select: { displayName: true } }, attachments: { select: { fileName: true } } } },
    },
  });
  const counts = await unreadCounts(actor, tickets.map((t) => t.id));
  let rows: InboxRow[] = tickets.filter((t) => t.messages[0]).map((t) => {
    const m = t.messages[0]!;
    return {
      ticketId: t.id, number: t.number, subject: t.subject, statusName: t.status.name, statusColor: t.status.color, requester: t.requester.displayName,
      lastAt: m.createdAt, lastSender: m.sender.displayName, lastType: m.type,
      preview: m.body ? m.body.slice(0, 160) : `📎 ${m.attachments.map((a) => a.fileName).join(", ")}`,
      unread: counts[t.id] ?? 0,
    };
  });
  if (opts.unreadOnly) rows = rows.filter((r) => r.unread > 0);
  rows.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  const totalUnread = Object.values(counts).reduce((a, b) => a + b, 0);
  return { rows: rows.slice((page - 1) * take, page * take), total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / take)), totalUnread };
}

/** Total unread chat messages across all visible tickets (for nav badges). */
export async function totalUnreadMessages(actor: Actor): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
      FROM "TicketMessage" m
     WHERE m."deletedAt" IS NULL
       AND m."senderId" <> ${actor.id}
       ${internalFilterSql(actor)}
       AND NOT EXISTS (SELECT 1 FROM "MessageRead" r WHERE r."messageId" = m.id AND r."userId" = ${actor.id})
       AND m."createdAt" > NOW() - INTERVAL '90 days'
       AND m."ticketId" IN (SELECT t.id FROM "Ticket" t WHERE t."requesterId" = ${actor.id} OR t."assignedAgentId" = ${actor.id}
            OR t."ownerTeamId" = ANY(${actor.teamIds}::text[])
            OR EXISTS (SELECT 1 FROM "TicketTask" k WHERE k."ticketId" = t.id AND (k."assignedAgentId" = ${actor.id} OR k."teamId" = ANY(${actor.teamIds}::text[]))))`;
  // Participant tickets only (requester / assignee / owner team / task team) — a subset of the actor's visible scope.
  return Number(rows[0]?.n ?? 0);
}
