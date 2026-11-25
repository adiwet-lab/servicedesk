import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/server/authz/actor";
import { VENDOR_FORBIDDEN_PERMISSIONS, type PermissionCode } from "@/server/authz/permissions";

/**
 * Builds the Actor from the database. Returns null (→ signed out) when the
 * account is not ACTIVE, access has expired, the tenant is disabled, or the
 * session was revoked (sessionVersion bumped by an admin).
 */
export async function loadActor(
  db: PrismaClient,
  userId: string,
  opts: { sessionVersion?: number; ip?: string | null; userAgent?: string | null; now?: Date } = {},
): Promise<Actor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      tenant: true,
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      teamMemberships: { where: { team: { isActive: true, deletedAt: null } } },
    },
  });
  if (!user || user.deletedAt) return null;
  if (user.status !== "ACTIVE") return null;
  if (!user.tenant.isActive) return null;
  if (user.accessExpiresAt && user.accessExpiresAt <= (opts.now ?? new Date())) return null;
  if (opts.sessionVersion !== undefined && opts.sessionVersion !== user.sessionVersion) return null;

  const perms = new Set<PermissionCode>();
  for (const ur of user.roles) for (const rp of ur.role.permissions) perms.add(rp.permission.code as PermissionCode);
  if (user.tenant.type === "VENDOR") for (const p of VENDOR_FORBIDDEN_PERMISSIONS) perms.delete(p);

  return {
    id: user.id,
    tenantId: user.tenantId,
    tenantType: user.tenant.type,
    email: user.email,
    displayName: user.displayName,
    companyId: user.companyId,
    departmentId: user.departmentId,
    branchId: user.branchId,
    locationId: user.locationId,
    ticketVisibility: user.ticketVisibility,
    roleCodes: user.roles.map((r) => r.role.code),
    permissions: perms,
    teamIds: user.teamMemberships.map((m) => m.teamId),
    leadTeamIds: user.teamMemberships.filter((m) => m.role === "LEAD").map((m) => m.teamId),
    locale: user.locale,
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
  };
}
