"use server";
import { revalidatePath } from "next/cache";
import { requireActorOrThrow } from "@/server/auth/get-actor";
import {
  retryOutbox, runGraphSyncNow, saveAssetConfig, saveGraphInterval, saveTeamsEvents, setTeamWebhook, setTenantGraphSync, testAssetLookup, testTeamWebhook,
} from "@/server/services/admin/integrations";
import { createApiToken, revokeApiToken } from "@/server/integrations/bi";
import { lookupAsset } from "@/server/integrations/assets";
import { runAction, formToObject, type ActionResult } from "./result";
import { rateLimiter } from "@/server/ratelimit";
import { isVendor } from "@/server/authz/actor";
import { canAny } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";

const PATH = "/admin/integrations";
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function toggleGraphSyncAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  await runAction(() => setTenantGraphSync(actor, str(fd, "tenantId"), str(fd, "enabled") === "true"));
  revalidatePath(PATH);
}

export async function graphSyncNowAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    const r = await runGraphSyncNow(actor, str(fd, "tenantId"));
    revalidatePath(PATH);
    if (r.error) throw new (await import("@/server/authz/errors")).ValidationError(`Sync failed: ${r.error}`);
    return undefined;
  }, "Directory sync finished");
}

export async function graphIntervalAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    await saveGraphInterval(actor, Number(str(fd, "hours")));
    revalidatePath(PATH);
    return undefined;
  }, "Saved");
}

export async function teamWebhookAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    await setTeamWebhook(actor, str(fd, "teamId"), str(fd, "clear") === "true" ? null : str(fd, "url"));
    revalidatePath(PATH);
    return undefined;
  }, "Webhook saved");
}

export async function testTeamWebhookAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    await testTeamWebhook(actor, str(fd, "teamId"));
    return undefined;
  }, "Test message sent");
}

export async function teamsEventsAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    await saveTeamsEvents(actor, fd.getAll("events").map(String));
    revalidatePath(PATH);
    return undefined;
  }, "Saved");
}

export async function assetConfigAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    await saveAssetConfig(actor, formToObject(fd));
    revalidatePath(PATH);
    return undefined;
  }, "Asset integration saved");
}

export async function testAssetAction(tag: string) {
  const actor = await requireActorOrThrow();
  const r = await runAction(() => testAssetLookup(actor, String(tag)));
  return r.ok ? r.data! : { provider: null, asset: null, error: r.error };
}

/** Lookup for the create-ticket form (any signed-in user; returns only display fields). */
export async function lookupAssetAction(tag: string) {
  const actor = await requireActorOrThrow();
  if (typeof tag !== "string" || tag.length > 64) return { provider: null, asset: null, error: "Invalid asset tag." };
  if (!(await rateLimiter.hit(`asset:lookup:${actor.id}`, 30, 60_000))) return { provider: null, asset: null, error: "Too many lookups — try again in a minute." };
  const r = await lookupAsset(tag);
  // Employees only confirm the device; who holds it and where stays with IT staff.
  const staff = !isVendor(actor) && canAny(actor, [P.TICKET_READ_TEAM, P.TICKET_READ_ALL]);
  if (r.asset && !staff) r.asset = { ...r.asset, serial: null, assignedTo: null, location: null };
  return r;
}

export async function createTokenAction(_p: ActionResult<{ token: string }> | null, fd: FormData): Promise<ActionResult<{ token: string }>> {
  return runAction(async () => {
    const actor = await requireActorOrThrow();
    const { token } = await createApiToken(actor, formToObject(fd));
    revalidatePath(PATH);
    return { token };
  }, "Token created — copy it now, it will not be shown again");
}

export async function revokeTokenAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  await runAction(() => revokeApiToken(actor, str(fd, "tokenId")));
  revalidatePath(PATH);
}

export async function retryOutboxAction(fd: FormData) {
  const actor = await requireActorOrThrow();
  await runAction(() => retryOutbox(actor, str(fd, "id")));
  revalidatePath(PATH);
}
