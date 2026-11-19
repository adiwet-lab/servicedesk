import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/server/authz/actor";

type Db = Prisma.TransactionClient | PrismaClient;

export interface NotifyInput {
  type: string;
  title: string;
  body?: string;
  ticketId?: string;
  link?: string;
}

/** Creates in-app notifications for the given users (excluding the actor). Phase 3 adds realtime push. */
export async function notifyUsers(db: Db, userIds: (string | null | undefined)[], n: NotifyInput, actor?: Pick<Actor, "id">) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x && x !== actor?.id))];
  if (ids.length === 0) return;
  await db.notification.createMany({
    data: ids.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body, ticketId: n.ticketId, link: n.link })),
  });
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
}
