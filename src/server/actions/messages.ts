"use server";
import { prisma } from "@/server/db";
import { requireActorOrThrow } from "@/server/auth/get-actor";
import { getChatPermissions, listMessages, markTicketRead, postMessage, totalUnreadMessages, unreadCounts } from "@/server/services/messages";
import { unreadCount } from "@/server/services/notifications";
import { runAction, filesFromForm, type ActionResult } from "./result";

export async function fetchMessagesAction(ticketId: string, opts: { before?: string; after?: string; q?: string } = {}) {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    return listMessages(actor, ticketId, { before: opts.before, after: opts.after, q: opts.q, limit: opts.q ? 100 : 50 });
  });
}

export async function postMessageAction(_prev: ActionResult<{ id: string }> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    const files = await filesFromForm(fd);
    return postMessage(actor, String(fd.get("ticketId") ?? ""), { type: fd.get("type") ?? "PUBLIC", body: fd.get("body") ?? "" }, files);
  });
}

export async function markTicketReadAction(ticketId: string) {
  return runAction(async () => markTicketRead(await requireActorOrThrow(), ticketId));
}

export async function chatPermissionsAction(ticketId: string) {
  return runAction(async () => getChatPermissions(await requireActorOrThrow(), ticketId));
}

/** Badge counts for the shell (bell + messages). */
export async function badgeCountsAction() {
  const actor = await requireActorOrThrow();
  const [notifications, messages] = await Promise.all([unreadCount(prisma, actor), totalUnreadMessages(actor)]);
  return { notifications, messages };
}

export async function ticketUnreadAction(ticketId: string) {
  const actor = await requireActorOrThrow();
  return (await unreadCounts(actor, [ticketId]))[ticketId] ?? 0;
}
