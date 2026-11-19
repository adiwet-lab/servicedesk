"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { requireActorOrThrow } from "@/server/auth/get-actor";
import {
  addTicketAttachments, assignTicket, changeTicketStatus, createTicket, removeTicketAttachment,
} from "@/server/services/tickets";
import { markNotificationsRead } from "@/server/services/notifications";
import { changeStatusSchema, assignTicketSchema } from "@/lib/validation/ticket";
import { runAction, formToObject, filesFromForm, type ActionResult } from "./result";

export async function createTicketAction(_prev: ActionResult<{ number: string }> | null, fd: FormData): Promise<ActionResult<{ number: string }>> {
  const result = await runAction(async () => {
    const actor = await requireActorOrThrow();
    const files = await filesFromForm(fd);
    const t = await createTicket(actor, formToObject(fd), files);
    return { number: t.number };
  });
  if (result.ok && result.data) redirect(`/tickets/${result.data.number}?created=1`);
  return result;
}

export async function changeStatusAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    const input = changeStatusSchema.parse(formToObject(fd));
    await changeTicketStatus(actor, { ...input, reason: input.reason ?? undefined, resolutionSummary: input.resolutionSummary ?? undefined });
    revalidatePath("/", "layout");
    return undefined;
  }, "Status updated");
}

export async function assignTicketAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    const input = assignTicketSchema.parse(formToObject(fd));
    await assignTicket(actor, { ticketId: input.ticketId, teamId: input.teamId, agentId: input.agentId, reason: input.reason ?? undefined });
    revalidatePath("/", "layout");
    return undefined;
  }, "Assignment updated");
}

export async function takeOwnershipAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  const ticketId = String(fd.get("ticketId") ?? "");
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { ownerTeamId: true } });
  await runAction(() => assignTicket(actor, { ticketId, teamId: ticket?.ownerTeamId ?? undefined, agentId: actor.id }));
  revalidatePath("/", "layout");
}

export async function uploadAttachmentsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    const files = await filesFromForm(fd);
    if (!files.length) throw new (await import("@/server/authz/errors")).ValidationError("Choose at least one file.");
    await addTicketAttachments(actor, String(fd.get("ticketId") ?? ""), files);
    revalidatePath("/", "layout");
    return undefined;
  }, "Attachment uploaded");
}

export async function removeAttachmentAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  await runAction(() => removeTicketAttachment(actor, String(fd.get("attachmentId") ?? "")));
  revalidatePath("/", "layout");
}

export async function markNotificationsReadAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  const id = fd.get("id");
  await markNotificationsRead(prisma, actor, id ? [String(id)] : undefined);
  revalidatePath("/", "layout");
}

/** Returns active agents of a team — for the assignment dialog. Only for actors who can assign. */
export async function teamAgentsAction(teamId: string) {
  const actor = await requireActorOrThrow();
  const { canAny } = await import("@/server/authz/guards");
  if (!canAny(actor, ["ticket.assign", "task.assign"])) return [];
  return prisma.user.findMany({
    where: { status: "ACTIVE", deletedAt: null, teamMemberships: { some: { teamId } } },
    select: { id: true, displayName: true }, orderBy: { displayName: "asc" },
  });
}
