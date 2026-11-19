import type { Actor } from "./actor";
import { AuthorizationError } from "./errors";
import { ADMIN_PORTAL_PERMISSIONS, type PermissionCode } from "./permissions";

export function can(actor: Pick<Actor, "permissions">, perm: PermissionCode): boolean {
  return actor.permissions.has(perm);
}

export function canAny(actor: Pick<Actor, "permissions">, perms: readonly PermissionCode[]): boolean {
  return perms.some((p) => actor.permissions.has(p));
}

export function requirePermission(actor: Pick<Actor, "permissions">, perm: PermissionCode): void {
  if (!can(actor, perm)) throw new AuthorizationError();
}

export function requireAnyPermission(actor: Pick<Actor, "permissions">, perms: readonly PermissionCode[]): void {
  if (!canAny(actor, perms)) throw new AuthorizationError();
}

export function canAccessAdminPortal(actor: Pick<Actor, "permissions">): boolean {
  return canAny(actor, ADMIN_PORTAL_PERMISSIONS);
}
