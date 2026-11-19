"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActorOrThrow } from "@/server/auth/get-actor";
import {
  declareMajorIncident, linkToIncident, postIncidentUpdate, reportAffected, resolveMajorIncident, setImpact, unlinkFromIncident,
} from "@/server/services/incidents";
import { runAction, formToObject, type ActionResult } from "./result";

const id = (fd: FormData, k = "ticketId") => String(fd.get(k) ?? "");

export async function setImpactAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    await setImpact(actor, id(fd), formToObject(fd, ["branchIds"]));
    revalidatePath("/", "layout");
    return undefined;
  }, "Impact updated");
}

export async function declareMajorAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    await declareMajorIncident(actor, id(fd), formToObject(fd));
    revalidatePath("/", "layout");
    return undefined;
  }, "Major incident declared");
}

export async function postIncidentUpdateAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    await postIncidentUpdate(actor, id(fd), formToObject(fd));
    revalidatePath("/", "layout");
    return undefined;
  }, "Update posted");
}

export async function linkTicketAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    await linkToIncident(actor, id(fd), String(fd.get("childNumber") ?? "").trim());
    revalidatePath("/", "layout");
    return undefined;
  }, "Ticket linked");
}

export async function unlinkTicketAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  await runAction(() => unlinkFromIncident(actor, id(fd, "childId")));
  revalidatePath("/", "layout");
}

export async function resolveIncidentAction(_p: ActionResult<{ resolved: string[]; skipped: { number: string; reason: string }[] }> | null, fd: FormData) {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    return resolveMajorIncident(actor, id(fd), formToObject(fd));
  });
  if (r.ok && r.data) {
    revalidatePath("/", "layout");
    const { resolved, skipped } = r.data;
    return { ...r, message: `Incident resolved${resolved.length ? ` · ${resolved.length} linked ticket(s) resolved` : ""}${skipped.length ? ` · skipped: ${skipped.map((s) => `${s.number} (${s.reason})`).join(", ")}` : ""}` };
  }
  return r;
}

export async function reportAffectedAction(_p: ActionResult<{ number: string }> | null, fd: FormData): Promise<ActionResult<{ number: string }>> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    const t = await reportAffected(actor, id(fd, "incidentId"), formToObject(fd));
    return { number: t.number };
  });
  if (r.ok && r.data) redirect(`/tickets/${r.data.number}?created=1`);
  return r;
}
