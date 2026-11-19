import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { requirePermission, can } from "@/server/authz/guards";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { PERMISSIONS as P, VENDOR_FORBIDDEN_PERMISSIONS, type PermissionCode } from "@/server/authz/permissions";
import { audit, diff } from "../audit";

const optId = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().min(1).nullable());
const optStr = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable().optional());

export const userUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  employeeId: optStr(50),
  jobTitle: optStr(200),
  contactNumber: optStr(50),
  companyId: optId,
  departmentId: optId,
  branchId: optId,
  locationId: optId,
  managerId: optId,
  ticketVisibility: z.enum(["OWN", "OWN_DEPT", "OWN_BRANCH", "OWN_DEPT_BRANCH"]),
  status: z.enum(["ACTIVE", "PENDING", "INACTIVE"]),
  accessExpiresAt: z.preprocess((v) => (v === "" || v == null ? null : new Date(String(v))), z.date().nullable()),
  roleIds: z.array(z.string()).default([]),
});

export const userCreateSchema = userUpdateSchema.extend({
  tenantId: z.string().min(1),
  email: z.string().trim().toLowerCase().email().max(320),
});

export async function listUsers(actor: Actor, q: { q?: string; tenant?: string; tenantType?: string; status?: string; role?: string; page?: number }) {
  requirePermission(actor, P.ADMIN_USERS);
  const page = Math.max(1, q.page ?? 1);
  const take = 25;
  const ci = q.q ? { contains: q.q, mode: "insensitive" as const } : undefined;
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(ci ? { OR: [{ displayName: ci }, { email: ci }, { employeeId: ci }] } : {}),
    ...(q.tenant ? { tenantId: q.tenant } : {}),
    ...(q.tenantType === "INTERNAL" || q.tenantType === "VENDOR" ? { tenant: { type: q.tenantType } } : {}),
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.role ? { roles: { some: { roleId: q.role } } } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where, skip: (page - 1) * take, take, orderBy: { displayName: "asc" },
      include: { tenant: true, department: true, branch: true, roles: { include: { role: true } }, teamMemberships: { include: { team: true } } },
    }),
  ]);
  return { total, rows, page, pages: Math.max(1, Math.ceil(total / take)) };
}

export async function getUserForEdit(actor: Actor, id: string) {
  requirePermission(actor, P.ADMIN_USERS);
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: { tenant: true, roles: true, teamMemberships: { include: { team: true } } },
  });
  if (!user) throw new NotFoundError();
  return user;
}

export async function getUserFormOptions() {
  const [tenants, companies, departments, branches, locations, roles, managers] = await Promise.all([
    prisma.tenant.findMany({ orderBy: { name: "asc" } }),
    prisma.company.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.branch.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ include: { permissions: { include: { permission: true } } }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
  ]);
  return { tenants, companies, departments, branches, locations, roles, managers };
}

/**
 * Privilege-escalation guard: an admin may only grant roles whose permissions
 * are all held by the admin themselves.
 */
async function assertCanGrantRoles(actor: Actor, roleIds: string[], tenantType: "INTERNAL" | "VENDOR") {
  if (roleIds.length === 0) return;
  const roles = await prisma.role.findMany({ where: { id: { in: roleIds } }, include: { permissions: { include: { permission: true } } } });
  if (roles.length !== new Set(roleIds).size) throw new ValidationError("Unknown role selected.");
  for (const r of roles) {
    for (const rp of r.permissions) {
      const code = rp.permission.code as PermissionCode;
      if (!actor.permissions.has(code)) throw new AuthorizationError(`You cannot grant role "${r.name}" because it includes permissions you do not hold.`);
    }
    if (tenantType === "VENDOR" && r.permissions.some((rp) => VENDOR_FORBIDDEN_PERMISSIONS.includes(rp.permission.code as PermissionCode))) {
      // Allowed to assign, but forbidden permissions are stripped at runtime for vendor users. Warn by refusing admin-level roles.
      if (r.permissions.some((rp) => rp.permission.code.startsWith("admin."))) {
        throw new ValidationError(`Role "${r.name}" includes administrative permissions and cannot be assigned to external vendor users.`);
      }
    }
  }
}

async function validateOrg(data: { companyId: string | null; departmentId: string | null; branchId: string | null; locationId: string | null }) {
  if (data.departmentId) {
    const d = await prisma.department.findUnique({ where: { id: data.departmentId } });
    if (!d || (data.companyId && d.companyId !== data.companyId)) throw new ValidationError("Department does not belong to the company.", { departmentId: "Department does not belong to the selected company" });
  }
  if (data.locationId) {
    const l = await prisma.location.findUnique({ where: { id: data.locationId } });
    if (!l || (data.branchId && l.branchId !== data.branchId)) throw new ValidationError("Location does not belong to the branch.", { locationId: "Location does not belong to the selected branch" });
  }
}

export async function updateUser(actor: Actor, id: string, raw: unknown) {
  requirePermission(actor, P.ADMIN_USERS);
  const parsed = userUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    throw new ValidationError("Please correct the highlighted fields.", fe);
  }
  const input = parsed.data;
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: { roles: true, tenant: true } });
  if (!user) throw new NotFoundError();
  if (id === actor.id && input.status !== "ACTIVE") throw new ValidationError("You cannot deactivate your own account.");
  if (input.managerId === id) throw new ValidationError("A user cannot be their own manager.", { managerId: "Invalid manager" });
  await validateOrg(input);

  const oldRoleIds = user.roles.map((r) => r.roleId).sort();
  const newRoleIds = [...new Set(input.roleIds)].sort();
  const rolesChanged = JSON.stringify(oldRoleIds) !== JSON.stringify(newRoleIds);
  if (rolesChanged) {
    const added = newRoleIds.filter((r) => !oldRoleIds.includes(r));
    const removed = oldRoleIds.filter((r) => !newRoleIds.includes(r));
    await assertCanGrantRoles(actor, [...added, ...removed], user.tenant.type);
    if (id === actor.id && removed.length) throw new ValidationError("You cannot remove roles from your own account.");
  }

  const { roleIds: _ignored, ...fields } = input;
  void _ignored;
  const d = diff(user as unknown as Record<string, unknown>, fields, Object.keys(fields) as never);
  // Revoke active sessions whenever access-relevant attributes change.
  const revoke = rolesChanged || input.status !== user.status || +(input.accessExpiresAt ?? 0) !== +(user.accessExpiresAt ?? 0) || input.ticketVisibility !== user.ticketVisibility;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { ...fields, ...(revoke ? { sessionVersion: { increment: 1 } } : {}) } });
    if (rolesChanged) {
      await tx.userRole.deleteMany({ where: { userId: id } });
      if (newRoleIds.length) await tx.userRole.createMany({ data: newRoleIds.map((roleId) => ({ userId: id, roleId })) });
      const names = await tx.role.findMany({ where: { id: { in: [...oldRoleIds, ...newRoleIds] } } });
      const nm = (ids: string[]) => ids.map((r) => names.find((n) => n.id === r)?.code ?? r);
      await audit(tx, actor, { action: "USER_PERMISSION_CHANGED", entityType: "User", entityId: id, oldValue: { roles: nm(oldRoleIds) }, newValue: { roles: nm(newRoleIds) } });
    }
    if (d.changed) {
      const action = input.status === "INACTIVE" && user.status !== "INACTIVE" ? "USER_DEACTIVATED" : "USER_UPDATED";
      await audit(tx, actor, { action, entityType: "User", entityId: id, oldValue: d.oldValue, newValue: d.newValue });
    }
  });
}

export async function createUser(actor: Actor, raw: unknown) {
  requirePermission(actor, P.ADMIN_USERS);
  const parsed = userCreateSchema.safeParse(raw);
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    throw new ValidationError("Please correct the highlighted fields.", fe);
  }
  const input = parsed.data;
  const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId } });
  if (!tenant) throw new ValidationError("Unknown tenant.", { tenantId: "Unknown tenant" });
  const dupe = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: { equals: input.email, mode: "insensitive" }, deletedAt: null } });
  if (dupe) throw new ValidationError("A user with this email already exists in the tenant.", { email: "Already exists in this tenant" });
  await validateOrg(input);
  await assertCanGrantRoles(actor, input.roleIds, tenant.type);
  const { roleIds, ...fields } = input;
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { ...fields, roles: { create: roleIds.map((roleId) => ({ roleId })) } } });
    await audit(tx, actor, { action: "USER_CREATED", entityType: "User", entityId: u.id, newValue: { email: u.email, tenant: tenant.name, roleIds } });
    return u;
  });
}

export async function revokeUserSessions(actor: Actor, id: string) {
  requirePermission(actor, P.ADMIN_USERS);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
    await audit(tx, actor, { action: "USER_SESSIONS_REVOKED", entityType: "User", entityId: id });
  });
}

// ───────────────────────────── Team members ─────────────────────────────

export async function getTeamWithMembers(actor: Actor, teamId: string) {
  requirePermission(actor, P.ADMIN_TEAMS);
  const team = await prisma.supportTeam.findFirst({
    where: { id: teamId, deletedAt: null },
    include: { tenant: true, lead: true, members: { include: { user: { include: { tenant: true, roles: { include: { role: true } } } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!team) throw new NotFoundError();
  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: null, status: "ACTIVE", teamMemberships: { none: { teamId } },
      ...(team.type === "INTERNAL" ? { tenant: { type: "INTERNAL" } } : team.tenantId ? { tenantId: team.tenantId } : {}),
    },
    select: { id: true, displayName: true, email: true }, orderBy: { displayName: "asc" },
  });
  return { team, candidates };
}

export async function addTeamMember(actor: Actor, teamId: string, userId: string, role: "MEMBER" | "LEAD") {
  requirePermission(actor, P.ADMIN_TEAMS);
  const [team, user] = await Promise.all([
    prisma.supportTeam.findFirst({ where: { id: teamId, deletedAt: null } }),
    prisma.user.findFirst({ where: { id: userId, deletedAt: null }, include: { tenant: true } }),
  ]);
  if (!team || !user) throw new NotFoundError();
  // Tenant isolation: vendor users only join non-internal teams of their own tenant.
  if (user.tenant.type === "VENDOR" && (team.type === "INTERNAL" || (team.tenantId && team.tenantId !== user.tenantId))) {
    throw new ValidationError("External users can only join their own organization's vendor/outsource team.");
  }
  if (team.type !== "INTERNAL" && team.tenantId && user.tenantId !== team.tenantId && user.tenant.type === "VENDOR") {
    throw new ValidationError("User belongs to a different tenant than this team.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.teamMember.create({ data: { teamId, userId, role } });
    if (role === "LEAD") await tx.supportTeam.update({ where: { id: teamId }, data: { leadId: userId } });
    await audit(tx, actor, { action: "TEAM_MEMBER_ADDED", entityType: "SupportTeam", entityId: teamId, newValue: { userId, user: user.displayName, role } });
  });
}

export async function updateTeamMember(actor: Actor, teamId: string, userId: string, role: "MEMBER" | "LEAD") {
  requirePermission(actor, P.ADMIN_TEAMS);
  const m = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
  if (!m) throw new NotFoundError();
  await prisma.$transaction(async (tx) => {
    await tx.teamMember.update({ where: { teamId_userId: { teamId, userId } }, data: { role } });
    if (role === "LEAD") await tx.supportTeam.update({ where: { id: teamId }, data: { leadId: userId } });
    else await tx.supportTeam.updateMany({ where: { id: teamId, leadId: userId }, data: { leadId: null } });
    await audit(tx, actor, { action: "TEAM_MEMBER_UPDATED", entityType: "SupportTeam", entityId: teamId, oldValue: { userId, role: m.role }, newValue: { userId, role } });
  });
}

export async function removeTeamMember(actor: Actor, teamId: string, userId: string) {
  requirePermission(actor, P.ADMIN_TEAMS);
  await prisma.$transaction(async (tx) => {
    await tx.teamMember.delete({ where: { teamId_userId: { teamId, userId } } });
    await tx.supportTeam.updateMany({ where: { id: teamId, leadId: userId }, data: { leadId: null } });
    await audit(tx, actor, { action: "TEAM_MEMBER_REMOVED", entityType: "SupportTeam", entityId: teamId, oldValue: { userId } });
  });
}

// ───────────────────────────── Roles ─────────────────────────────

export const roleSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_]+$/, "Uppercase letters, digits and _ only").max(40).optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().nullable(),
  defaultTicketVisibility: z.enum(["OWN", "OWN_DEPT", "OWN_BRANCH", "OWN_DEPT_BRANCH"]),
  permissions: z.array(z.string()).default([]),
});

export async function listRoles(actor: Actor) {
  requirePermission(actor, P.ADMIN_ROLES);
  return prisma.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } }, orderBy: { name: "asc" } });
}

export async function saveRole(actor: Actor, id: string | null, raw: unknown) {
  requirePermission(actor, P.ADMIN_ROLES);
  const parsed = roleSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
  const input = parsed.data;
  const perms = await prisma.permission.findMany({ where: { code: { in: input.permissions } } });
  if (perms.length !== new Set(input.permissions).size) throw new ValidationError("Unknown permission.");
  for (const p of perms) if (!can(actor, p.code as PermissionCode)) throw new AuthorizationError(`You cannot grant "${p.code}" which you do not hold.`);

  try {
    await prisma.$transaction(async (tx) => {
      let roleId = id;
      let before: string[] = [];
      if (id) {
        const role = await tx.role.findUniqueOrThrow({ where: { id }, include: { permissions: { include: { permission: true } } } });
        before = role.permissions.map((p) => p.permission.code).sort();
        if (role.code === "SUPER_ADMIN" && !input.permissions.includes(P.ADMIN_ROLES)) {
          throw new ValidationError("Super Admin must keep admin.roles to avoid lock-out.");
        }
        await tx.role.update({ where: { id }, data: { name: input.name, description: input.description, defaultTicketVisibility: input.defaultTicketVisibility } });
      } else {
        if (!input.code) throw new ValidationError("Role code is required.");
        const r = await tx.role.create({ data: { code: input.code, name: input.name, description: input.description, defaultTicketVisibility: input.defaultTicketVisibility } });
        roleId = r.id;
      }
      await tx.rolePermission.deleteMany({ where: { roleId: roleId! } });
      if (perms.length) await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: roleId!, permissionId: p.id })) });
      const after = perms.map((p) => p.code).sort();
      if (JSON.stringify(before) !== JSON.stringify(after) || !id) {
        await audit(tx, actor, { action: "USER_PERMISSION_CHANGED", entityType: "Role", entityId: roleId, oldValue: { permissions: before }, newValue: { name: input.name, permissions: after } });
        // No session revocation needed: permissions are reloaded from the DB on every request.
      }
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ValidationError("Role code already exists.");
    throw e;
  }
}

// ───────────────────────────── Workflow transitions ─────────────────────────────

export async function getWorkflowMatrix(actor: Actor) {
  requirePermission(actor, P.ADMIN_WORKFLOW);
  const [statuses, transitions] = await Promise.all([
    prisma.ticketStatus.findMany({ orderBy: { order: "asc" } }),
    prisma.workflowTransition.findMany(),
  ]);
  return { statuses, transitions };
}

export const transitionSchema = z.object({
  fromStatusId: z.string().min(1),
  toStatusId: z.string().min(1),
  enabled: z.boolean(),
  requiredPermission: z.string().default(P.TICKET_UPDATE),
  requesterAllowed: z.boolean().default(false),
  requiresComment: z.boolean().default(false),
});

export async function saveTransition(actor: Actor, raw: unknown) {
  requirePermission(actor, P.ADMIN_WORKFLOW);
  const t = transitionSchema.parse(raw);
  if (t.fromStatusId === t.toStatusId) throw new ValidationError("A status cannot transition to itself.");
  const perm = await prisma.permission.findUnique({ where: { code: t.requiredPermission } });
  if (!perm) throw new ValidationError("Unknown permission.");
  const key = { fromStatusId_toStatusId: { fromStatusId: t.fromStatusId, toStatusId: t.toStatusId } };
  await prisma.$transaction(async (tx) => {
    const existing = await tx.workflowTransition.findUnique({ where: key });
    if (!t.enabled) {
      if (existing) await tx.workflowTransition.delete({ where: key });
    } else {
      await tx.workflowTransition.upsert({
        where: key,
        update: { requiredPermission: t.requiredPermission, requesterAllowed: t.requesterAllowed, requiresComment: t.requiresComment },
        create: { fromStatusId: t.fromStatusId, toStatusId: t.toStatusId, requiredPermission: t.requiredPermission, requesterAllowed: t.requesterAllowed, requiresComment: t.requiresComment },
      });
    }
    await audit(tx, actor, { action: "WORKFLOW_TRANSITION_CHANGED", entityType: "WorkflowTransition", oldValue: existing, newValue: t });
  });
}
