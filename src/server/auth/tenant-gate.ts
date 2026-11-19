import type { PrismaClient } from "@prisma/client";

/** Subset of Microsoft Entra ID v2.0 ID-token claims we rely on. */
export interface EntraClaims {
  tid?: unknown;
  oid?: unknown;
  iss?: unknown;
  email?: unknown;
  preferred_username?: unknown;
  name?: unknown;
}

export type GateFailure =
  | "missing_claims"
  | "issuer_mismatch"
  | "tenant_not_allowed"
  | "tenant_inactive"
  | "account_pending"
  | "account_inactive"
  | "access_expired";

export type ClaimsResult =
  | { ok: true; tid: string; oid: string; email: string; name: string }
  | { ok: false; reason: GateFailure };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pure validation of ID-token claims. Identity = (tid, oid). Email/UPN are
 * informational only and never used to decide which tenant a user belongs to.
 */
export function validateEntraClaims(claims: EntraClaims): ClaimsResult {
  const tid = typeof claims.tid === "string" ? claims.tid.toLowerCase() : "";
  const oid = typeof claims.oid === "string" ? claims.oid.toLowerCase() : "";
  if (!GUID.test(tid) || !GUID.test(oid)) return { ok: false, reason: "missing_claims" };

  // The library already validated the token against the tenant-specific issuer.
  // Defence in depth: the issuer must be exactly that tenant's v2.0 issuer.
  const expectedIss = `https://login.microsoftonline.com/${tid}/v2.0`;
  if (typeof claims.iss !== "string" || claims.iss.toLowerCase() !== expectedIss) {
    return { ok: false, reason: "issuer_mismatch" };
  }

  const email =
    (typeof claims.email === "string" && claims.email) ||
    (typeof claims.preferred_username === "string" && claims.preferred_username) ||
    "";
  const name = (typeof claims.name === "string" && claims.name) || email || oid;
  return { ok: true, tid, oid, email: email.toLowerCase(), name };
}

export type ResolveResult = { ok: true; userId: string; created: boolean } | { ok: false; reason: GateFailure };

/**
 * Maps validated claims to an application user:
 *  1. Tenant must be registered and active (allow-list).
 *  2. Existing user by (tenant, oid) → use it.
 *  3. Admin-pre-created user in the SAME tenant with no oid yet and matching email → link.
 *  4. Otherwise auto-provision when the tenant allows it; else create as PENDING for admin approval.
 *  5. User must be ACTIVE and not past accessExpiresAt.
 */
export async function resolveEntraUser(db: PrismaClient, claims: EntraClaims, now = new Date()): Promise<ResolveResult> {
  const v = validateEntraClaims(claims);
  if (!v.ok) return v;

  const tenant = await db.tenant.findUnique({ where: { entraTenantId: v.tid } });
  if (!tenant) return { ok: false, reason: "tenant_not_allowed" };
  if (!tenant.isActive) return { ok: false, reason: "tenant_inactive" };

  let created = false;
  let user = await db.user.findUnique({
    where: { tenantId_entraObjectId: { tenantId: tenant.id, entraObjectId: v.oid } },
  });

  if (!user && v.email) {
    const precreated = await db.user.findFirst({
      where: { tenantId: tenant.id, entraObjectId: null, email: { equals: v.email, mode: "insensitive" }, deletedAt: null },
    });
    if (precreated) {
      user = await db.user.update({ where: { id: precreated.id }, data: { entraObjectId: v.oid } });
    }
  }

  if (!user) {
    created = true;
    const roleId = tenant.defaultRoleId;
    const role = roleId ? await db.role.findUnique({ where: { id: roleId } }) : null;
    user = await db.user.create({
      data: {
        tenantId: tenant.id,
        entraObjectId: v.oid,
        email: v.email || `${v.oid}@unknown`,
        displayName: v.name,
        companyId: tenant.companyId,
        status: tenant.autoProvisionUsers ? "ACTIVE" : "PENDING",
        ticketVisibility: role?.defaultTicketVisibility ?? "OWN",
        roles: roleId && tenant.autoProvisionUsers ? { create: [{ roleId }] } : undefined,
      },
    });
    await db.auditLog.create({
      data: {
        action: "USER_PROVISIONED",
        entityType: "User",
        entityId: user.id,
        actorId: user.id,
        newValue: { tenant: tenant.name, status: user.status, email: user.email },
      },
    });
  }

  if (user.deletedAt || user.status === "INACTIVE") return { ok: false, reason: "account_inactive" };
  if (user.status === "PENDING") return { ok: false, reason: "account_pending" };
  if (user.accessExpiresAt && user.accessExpiresAt <= now) return { ok: false, reason: "access_expired" };

  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: now, ...(v.email && v.email !== user.email ? { email: v.email } : {}) },
  });
  return { ok: true, userId: user.id, created };
}

export const GATE_MESSAGES: Record<GateFailure | "session_revoked" | "Default", string> = {
  missing_claims: "Your Microsoft token is missing required identity claims.",
  issuer_mismatch: "The sign-in token issuer could not be verified.",
  tenant_not_allowed: "Your organization is not authorized to use this service desk.",
  tenant_inactive: "Access for your organization has been disabled.",
  account_pending: "Your account is awaiting approval by an administrator.",
  account_inactive: "Your account has been deactivated.",
  access_expired: "Your access period has expired. Please contact the IT administrator.",
  session_revoked: "Your session is no longer valid. Please sign in again.",
  Default: "Sign-in failed. Please try again.",
};
