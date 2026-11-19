import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { auth } from "./auth";
import { loadActor } from "./load-actor";
import type { Actor } from "@/server/authz/actor";
import { AuthorizationError } from "@/server/authz/errors";
import { canAccessAdminPortal } from "@/server/authz/guards";
import { clientIp } from "@/server/net";

export { clientIp } from "@/server/net";

/** Current actor or null. Cached per request; reloads user state from DB every request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  if (!session?.uid) return null;
  const h = await headers();
  return loadActor(prisma, session.uid, {
    sessionVersion: session.sv,
    ip: clientIp(h),
    userAgent: h.get("user-agent"),
  });
});

/** For pages/layouts: redirect to login if not signed in or revoked. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) {
    const session = await auth();
    redirect(session?.uid ? "/login?error=session_revoked" : "/login");
  }
  return actor;
}

/** For server actions / route handlers: throw instead of redirect. */
export async function requireActorOrThrow(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AuthorizationError("Not signed in.");
  return actor;
}

export async function requireAdminPortal(): Promise<Actor> {
  const actor = await requireActor();
  if (!canAccessAdminPortal(actor)) redirect("/dashboard");
  return actor;
}
