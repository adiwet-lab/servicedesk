"use server";
import { revalidatePath } from "next/cache";
import { requireActorOrThrow } from "@/server/auth/get-actor";
import {
  chatCaseHeader, chatQueue, claimChat, followUpList, saveChatFilter, startChatCase, unclaimedChatCount,
} from "@/server/services/chat-cases";
import { currentLocale } from "@/i18n/server";
import { runAction, filesFromForm, type ActionResult } from "./result";

/** Guided "new case" submit: category, subcategory, branch, details (+ files, + required extra fields). */
export async function startChatCaseAction(_prev: ActionResult<{ id: string; number: string }> | null, fd: FormData): Promise<ActionResult<{ id: string; number: string }>> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    const files = await filesFromForm(fd);
    const extra: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("extra.") && typeof v === "string" && v.trim()) extra[k.slice(6)] = v.trim();
    const r = await startChatCase(actor, {
      categoryId: String(fd.get("categoryId") ?? ""), subcategoryId: String(fd.get("subcategoryId") ?? "") || undefined,
      branchId: String(fd.get("branchId") ?? "") || undefined, body: String(fd.get("body") ?? ""), extra,
    }, files);
    revalidatePath("/chat");
    return r;
  });
}

export async function followUpListAction() {
  return runAction(async () => followUpList(await requireActorOrThrow(), await currentLocale()));
}

export async function chatCaseHeaderAction(ticketId: string) {
  return runAction(async () => chatCaseHeader(await requireActorOrThrow(), ticketId, await currentLocale()));
}

export async function chatQueueAction(filter: unknown, q?: string) {
  return runAction(async () => chatQueue(await requireActorOrThrow(), filter, { q, locale: await currentLocale() }));
}

export async function saveChatFilterAction(filter: unknown) {
  return runAction(async () => saveChatFilter(await requireActorOrThrow(), filter), "Saved");
}

export async function claimChatAction(ticketId: string, teamId?: string) {
  return runAction(async () => {
    const r = await claimChat(await requireActorOrThrow(), ticketId, teamId);
    revalidatePath("/admin/chat");
    return r;
  });
}

export async function unclaimedChatCountAction() {
  return unclaimedChatCount(await requireActorOrThrow());
}
