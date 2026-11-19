import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/server/authz/actor";
import { queueEvent, rooms } from "@/server/realtime/bus";
import { getSetting } from "./settings";

type Db = Prisma.TransactionClient | PrismaClient;

/** Catalog of notification events (Admin → System → Notification Settings). */
export const NOTIFICATION_TYPES = {
  TICKET_CREATED: "Ticket created",
  TICKET_ASSIGNED: "Ticket assigned",
  TICKET_REASSIGNED: "Ticket reassigned",
  TICKET_TRANSFERRED: "Ticket transferred",
  STATUS_CHANGED: "Ticket status changed",
  TICKET_UPDATED: "Ticket details updated",
  TICKET_ESCALATED: "Ticket escalated",
  TICKET_RESOLVED: "Ticket resolved",
  TICKET_CLOSED: "Ticket closed",
  NEW_MESSAGE: "New chat message",
  TASK_CREATED: "Task created",
  TASK_ASSIGNED: "Task assigned",
  TASK_UPDATED: "Task updated",
  TASK_OVERDUE: "Task overdue",
  SLA_WARNING: "SLA warning",
  SLA_BREACHED: "SLA breached",
  MAJOR_INCIDENT: "Major incident declared / updated / resolved",
  APPROVAL_REQUESTED: "Approval requested from me",
  APPROVAL_DECIDED: "Approval decision on my ticket",
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export interface NotifyInput {
  type: string;
  title: string;
  body?: string;
  ticketId?: string;
  link?: string;
}

/**
 * Delivery channels. In-app is always available; Email and Microsoft Teams are
 * defined for later phases and report themselves as not configured.
 */
export interface NotificationChannel {
  id: "inapp" | "email" | "teams";
  label: string;
  configured: boolean;
}
export const CHANNELS: NotificationChannel[] = [
  { id: "inapp", label: "In-app", configured: true },
  { id: "email", label: "Email", configured: false },
  { id: "teams", label: "Microsoft Teams", configured: false },
];

/**
 * Creates in-app notifications (excluding the actor) and pushes a realtime
 * `notify` signal to each recipient after the transaction commits.
 * NEW_MESSAGE notifications are coalesced per ticket while still unread.
 */
export async function notifyUsers(db: Db, userIds: (string | null | undefined)[], n: NotifyInput, actor?: Pick<Actor, "id">) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x && x !== actor?.id))];
  if (ids.length === 0) return;
  const disabled = await getSetting(db, "notifications.disabledTypes");
  if (disabled.includes(n.type)) return;

  let createFor = ids;
  if (n.type === "NEW_MESSAGE" && n.ticketId) {
    const existing = await db.notification.findMany({
      where: { userId: { in: ids }, ticketId: n.ticketId, type: "NEW_MESSAGE", readAt: null },
      select: { id: true, userId: true },
    });
    if (existing.length) {
      await db.notification.updateMany({
        where: { id: { in: existing.map((e) => e.id) } },
        data: { title: n.title, body: n.body, link: n.link, createdAt: new Date() },
      });
      const covered = new Set(existing.map((e) => e.userId));
      createFor = ids.filter((id) => !covered.has(id));
    }
  }
  if (createFor.length) {
    await db.notification.createMany({
      data: createFor.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body, ticketId: n.ticketId, link: n.link })),
    });
  }
  for (const userId of ids) {
    queueEvent(db, { room: rooms.user(userId), event: "notify", payload: { type: n.type, title: n.title, ticketId: n.ticketId ?? null, link: n.link ?? null } });
  }
}

/** Active members of a team (optionally only leads). */
export async function teamMemberIds(db: Db, teamId: string | null | undefined, leadsOnly = false): Promise<string[]> {
  if (!teamId) return [];
  const members = await db.teamMember.findMany({
    where: { teamId, ...(leadsOnly ? { role: "LEAD" } : {}), user: { status: "ACTIVE", deletedAt: null } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

export async function listNotifications(db: PrismaClient, actor: Actor, opts: { unreadOnly?: boolean; take?: number } = {}) {
  return db.notification.findMany({
    where: { userId: actor.id, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
  });
}

export async function unreadCount(db: PrismaClient, actor: Actor) {
  return db.notification.count({ where: { userId: actor.id, readAt: null } });
}

export async function markNotificationsRead(db: PrismaClient, actor: Actor, ids?: string[]) {
  await db.notification.updateMany({
    where: { userId: actor.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  queueEvent(null, { room: rooms.user(actor.id), event: "notify:read", payload: {} });
}
