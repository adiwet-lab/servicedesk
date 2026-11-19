"use server";
import { revalidatePath } from "next/cache";
import { requireActorOrThrow } from "@/server/auth/get-actor";
import { decideApproval, deletePolicy, policyFromForm, savePolicy } from "@/server/services/approvals";
import { runAction, formToObject, type ActionResult } from "./result";

export async function decideApprovalAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    await decideApproval(actor, String(fd.get("approvalId") ?? ""), formToObject(fd));
    revalidatePath("/", "layout");
    return undefined;
  }, "Decision recorded");
}

export async function savePolicyAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    const id = String(fd.get("policyId") ?? "") || null;
    await savePolicy(actor, id, policyFromForm(formToObject(fd)));
    revalidatePath("/admin/config/approvals");
    return undefined;
  }, "Policy saved");
}

export async function deletePolicyAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  await runAction(() => deletePolicy(actor, String(fd.get("policyId") ?? "")));
  revalidatePath("/admin/config/approvals");
}
