"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActorOrThrow } from "@/server/auth/get-actor";
import { saveCrud, setCrudActive, type CrudResult } from "@/server/services/admin/crud";
import {
  addTeamMember, createUser, removeTeamMember, revokeUserSessions, saveRole, saveTransition, updateTeamMember, updateUser,
} from "@/server/services/admin/users";
import { saveSequence, saveSystemSettings } from "@/server/services/admin/system";
import { runAction, formToObject, type ActionResult } from "./result";
import { currentLocale } from "@/i18n/server";

export async function saveCrudAction(entity: string, id: string | null, multi: string[], fd: FormData): Promise<CrudResult> {
  const actor = await requireActorOrThrow();
  const locale = await currentLocale();
  const res = await runAction(() => saveCrud(actor, entity, id, formToObject(fd, multi), locale));
  revalidatePath("/admin", "layout");
  if (!res.ok) return res;
  return res.data!;
}

export async function setCrudActiveAction(entity: string, id: string, active: boolean): Promise<CrudResult> {
  const actor = await requireActorOrThrow();
  const locale = await currentLocale();
  const res = await runAction(() => setCrudActive(actor, entity, id, active, locale));
  revalidatePath("/admin", "layout");
  if (!res.ok) return res;
  return res.data!;
}

export async function saveUserAction(id: string | null, _prev: ActionResult<{ id: string }> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const res = await runAction(async () => {
    const actor = await requireActorOrThrow();
    const data = formToObject(fd, ["roleIds"]);
    if (id) {
      await updateUser(actor, id, data);
      return { id };
    }
    const u = await createUser(actor, data);
    return { id: u.id };
  }, "User saved");
  revalidatePath("/admin", "layout");
  if (res.ok && !id) redirect(`/admin/system/users/${res.data!.id}?saved=1`);
  return res;
}

export async function revokeSessionsAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  await runAction(() => revokeUserSessions(actor, String(fd.get("userId"))));
  revalidatePath("/admin", "layout");
}

export async function addMemberAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    await addTeamMember(actor, String(fd.get("teamId")), String(fd.get("userId")), fd.get("role") === "LEAD" ? "LEAD" : "MEMBER");
  });
  revalidatePath("/admin", "layout");
  return r as ActionResult;
}

export async function memberRoleAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  await runAction(() => updateTeamMember(actor, String(fd.get("teamId")), String(fd.get("userId")), fd.get("role") === "LEAD" ? "LEAD" : "MEMBER"));
  revalidatePath("/admin", "layout");
}

export async function removeMemberAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  await runAction(() => removeTeamMember(actor, String(fd.get("teamId")), String(fd.get("userId"))));
  revalidatePath("/admin", "layout");
}

export async function saveRoleAction(id: string | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    const data = formToObject(fd, ["permissions"]);
    await saveRole(actor, id, data);
  }, "Role saved");
  revalidatePath("/admin", "layout");
  return r as ActionResult;
}

export async function saveTransitionAction(input: { fromStatusId: string; toStatusId: string; enabled: boolean; requiredPermission: string; requesterAllowed: boolean; requiresComment: boolean }): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    await saveTransition(actor, input);
  });
  revalidatePath("/admin", "layout");
  return r as ActionResult;
}

export async function saveSettingsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    const raw = formToObject(fd, ["attachments.allowedExtensions"]);
    const num = (k: string) => (raw[k] === undefined ? undefined : Number(raw[k]));
    await saveSystemSettings(actor, {
      "attachments.maxFileSizeMb": num("attachments.maxFileSizeMb"),
      "attachments.maxFilesPerUpload": num("attachments.maxFilesPerUpload"),
      "attachments.allowedExtensions": raw["attachments.allowedExtensions"],
      "attachments.malwareScan": raw["attachments.malwareScan"],
      "tickets.reopenWindowDays": num("tickets.reopenWindowDays"),
      "tickets.autoCloseResolvedDays": num("tickets.autoCloseResolvedDays"),
      "tickets.fallbackTeamCode": raw["tickets.fallbackTeamCode"],
      "tickets.requesterCanSetPriority": raw["tickets.requesterCanSetPriority"] === "on",
      "tickets.defaultPriorityCode": raw["tickets.defaultPriorityCode"],
      "workflow.assignedStatusCode": raw["workflow.assignedStatusCode"],
      "workflow.requesterReplyStatusCode": raw["workflow.requesterReplyStatusCode"] ?? "",
    });
  }, "Settings saved");
  revalidatePath("/admin", "layout");
  return r as ActionResult;
}

export async function saveSequenceAction(_prev: ActionResult<string> | null, fd: FormData): Promise<ActionResult<string>> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    return saveSequence(actor, { key: fd.get("key"), prefix: fd.get("prefix"), format: fd.get("format"), resetYearly: fd.get("resetYearly") === "on" });
  }, "Numbering saved");
  revalidatePath("/admin", "layout");
  return r;
}

export async function saveNotificationSettingsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    const enabled = new Set(fd.getAll("enabled").map(String));
    const { NOTIFICATION_TYPES } = await import("@/server/services/notifications");
    const disabled = Object.keys(NOTIFICATION_TYPES).filter((t) => !enabled.has(t));
    await saveSystemSettings(actor, { "notifications.disabledTypes": disabled });
  }, "Notification settings saved");
  revalidatePath("/admin", "layout");
  return r as ActionResult;
}

export async function saveSlaTargetsAction(profileId: string, rows: { priorityId: string; responseMinutes: number; resolutionMinutes: number; businessHoursOnly: boolean }[]): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    const { saveSlaTargets } = await import("@/server/services/admin/system");
    await saveSlaTargets(actor, profileId, rows);
  }, "SLA targets saved");
  revalidatePath("/admin", "layout");
  return r as ActionResult;
}

export async function saveBusinessHoursAction(id: string | null, payload: unknown): Promise<ActionResult> {
  const r = await runAction(async () => {
    const actor = await requireActorOrThrow();
    const { saveBusinessHours } = await import("@/server/services/admin/system");
    await saveBusinessHours(actor, id, payload);
  }, "Business hours saved");
  revalidatePath("/admin", "layout");
  return r as ActionResult;
}

export async function runSlaCheckAction() {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    const { runSlaCheckNow } = await import("@/server/services/admin/system");
    return runSlaCheckNow(actor);
  });
}
