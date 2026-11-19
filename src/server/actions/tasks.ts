"use server";
import { revalidatePath } from "next/cache";
import { requireActorOrThrow } from "@/server/auth/get-actor";
import { addTaskAttachments, assignTask, changeTaskStatus, createTask, removeTaskAttachment, updateTask } from "@/server/services/tasks";
import { addSupportingTeam, escalateTicket, removeSupportingTeam, updateTicketFields } from "@/server/services/ticket-updates";
import { runAction, formToObject, filesFromForm, type ActionResult } from "./result";

const done = () => revalidatePath("/", "layout");

export async function createTaskAction(_prev: ActionResult<{ number: string }> | null, fd: FormData): Promise<ActionResult<{ number: string }>> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    const t = await createTask(actor, String(fd.get("ticketId") ?? ""), formToObject(fd));
    return { number: t.number };
  }, "Task created");
  done();
  return r;
}

export async function updateTaskAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    await updateTask(actor, String(fd.get("taskId") ?? ""), formToObject(fd));
  }, "Task updated");
  done();
  return r as ActionResult;
}

export async function taskStatusAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    await changeTaskStatus(actor, String(fd.get("taskId") ?? ""), { status: String(fd.get("status") ?? ""), reason: (fd.get("reason") as string) || null });
  }, "Task status updated");
  done();
  return r as ActionResult;
}

export async function assignTaskAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    await assignTask(actor, String(fd.get("taskId") ?? ""), {
      teamId: (fd.get("teamId") as string) || null, agentId: (fd.get("agentId") as string) || null, reason: (fd.get("reason") as string) || null,
    });
  }, "Task assignment updated");
  done();
  return r as ActionResult;
}

export async function taskSelfAssignAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  await runAction(() => assignTask(actor, String(fd.get("taskId") ?? ""), { teamId: (fd.get("teamId") as string) || null, agentId: actor.id }));
  done();
}

export async function uploadTaskAttachmentsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    await addTaskAttachments(actor, String(fd.get("taskId") ?? ""), await filesFromForm(fd));
  }, "Attachment uploaded");
  done();
  return r as ActionResult;
}

export async function removeTaskAttachmentAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  await runAction(() => removeTaskAttachment(actor, String(fd.get("attachmentId") ?? "")));
  done();
}

export async function updateTicketAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    await updateTicketFields(actor, String(fd.get("ticketId") ?? ""), formToObject(fd));
  }, "Ticket updated");
  done();
  return r as ActionResult;
}

export async function addSupportingTeamAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    await addSupportingTeam(actor, String(fd.get("ticketId") ?? ""), String(fd.get("teamId") ?? ""));
  }, "Supporting team added");
  done();
  return r as ActionResult;
}

export async function removeSupportingTeamAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    await removeSupportingTeam(actor, String(fd.get("ticketId") ?? ""), String(fd.get("teamId") ?? ""));
  });
  done();
  return r as ActionResult;
}

export async function escalateTicketAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    await escalateTicket(actor, String(fd.get("ticketId") ?? ""), formToObject(fd));
  }, "Ticket escalated");
  done();
  return r as ActionResult;
}
