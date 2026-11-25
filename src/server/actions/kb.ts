"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActorOrThrow } from "@/server/auth/get-actor";
import {
  createArticle, createArticleFromTicket, giveFeedback, setArticleStatus, suggestArticles, updateArticle,
} from "@/server/services/kb";
import { ValidationError } from "@/server/authz/errors";
import { currentLocale } from "@/i18n/server";
import { runAction, formToObject, type ActionResult } from "./result";

export async function createArticleAction(_p: ActionResult<{ number: string }> | null, fd: FormData): Promise<ActionResult<{ number: string }>> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    const a = await createArticle(actor, formToObject(fd));
    return { number: a.number };
  });
  if (r.ok && r.data) redirect(`/admin/kb/${r.data.number}?saved=1`);
  return r;
}

export async function updateArticleAction(_p: ActionResult<{ number: string }> | null, fd: FormData): Promise<ActionResult<{ number: string }>> {
  return runAction<{ number: string } | undefined>(async () => {
    const actor = await requireActorOrThrow();
    await updateArticle(actor, String(fd.get("articleId") ?? ""), formToObject(fd));
    revalidatePath("/admin/kb", "layout");
    revalidatePath("/help", "layout");
    return undefined;
  }, "Article saved");
}

export async function setArticleStatusAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  const status = String(fd.get("status") ?? "");
  await runAction(async () => {
    if (status !== "PUBLISHED" && status !== "ARCHIVED" && status !== "DRAFT") throw new ValidationError("Invalid status");
    await setArticleStatus(actor, String(fd.get("articleId") ?? ""), status);
  });
  revalidatePath("/admin/kb", "layout");
  revalidatePath("/help", "layout");
}

export async function createArticleFromTicketAction(_p: ActionResult<{ number: string }> | null, fd: FormData): Promise<ActionResult<{ number: string }>> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    const a = await createArticleFromTicket(actor, String(fd.get("ticketId") ?? ""), await currentLocale());
    return { number: a.number };
  });
  if (r.ok && r.data) redirect(`/admin/kb/${r.data.number}?fromTicket=1`);
  return r;
}

export async function feedbackAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    await giveFeedback(actor, String(fd.get("articleId") ?? ""), formToObject(fd));
    revalidatePath("/help", "layout");
    return undefined;
  }, "Thanks for your feedback!");
}

/** "This solved my problem" from the create-ticket suggestions: helpful vote + deflection audit. */
export async function deflectAction(articleId: string, number: string) {
  const actor = await requireActorOrThrow();
  const r = await runAction(() => giveFeedback(actor, String(articleId), { helpful: true }, { deflected: true }));
  if (r.ok) redirect(`/help/${encodeURIComponent(String(number))}?solved=1`);
  return r;
}

export async function suggestArticlesAction(text: string, categoryId?: string) {
  const actor = await requireActorOrThrow();
  if (typeof text !== "string" || text.length > 400) return [];
  const rows = await suggestArticles(actor, text, typeof categoryId === "string" ? categoryId : undefined, await currentLocale());
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.title, snippet: r.snippet, type: r.type }));
}
