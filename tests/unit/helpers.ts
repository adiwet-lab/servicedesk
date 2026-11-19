import type { Actor } from "@/server/authz/actor";
import { DEFAULT_ROLE_MATRIX, VENDOR_FORBIDDEN_PERMISSIONS, type PermissionCode, type RoleCode } from "@/server/authz/permissions";

export function makeActor(role: RoleCode, over: Partial<Actor> = {}): Actor {
  const perms = new Set<PermissionCode>(DEFAULT_ROLE_MATRIX[role].permissions);
  if (over.tenantType === "VENDOR") for (const p of VENDOR_FORBIDDEN_PERMISSIONS) perms.delete(p);
  return {
    id: "u1", tenantId: "t1", tenantType: "INTERNAL", email: "u1@x", displayName: "U1", companyId: "c1",
    departmentId: "d1", branchId: "b1", locationId: null, ticketVisibility: "OWN", roleCodes: [role],
    permissions: perms, teamIds: [], leadTeamIds: [], ...over,
  };
}
