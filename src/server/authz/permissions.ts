/**
 * Permission catalog — the single source of truth for permission codes.
 * The seed syncs these into the Permission table; roles map to them in the DB
 * (editable by admins). DEFAULT_ROLE_MATRIX seeds the initial role mappings and
 * is also rendered in docs/04-rbac-matrix.md.
 */
export const PERMISSIONS = {
  // Tickets
  TICKET_CREATE: "ticket.create",
  TICKET_READ_OWN: "ticket.read.own",
  TICKET_READ_TEAM: "ticket.read.team",
  TICKET_READ_ALL: "ticket.read.all",
  TICKET_UPDATE: "ticket.update",
  TICKET_ASSIGN: "ticket.assign",
  TICKET_TRANSFER: "ticket.transfer",
  TICKET_ESCALATE: "ticket.escalate",
  TICKET_CONFIDENTIAL_READ: "ticket.confidential.read",
  TICKET_CLOSED_EDIT: "ticket.closed.edit",
  // Notes & chat
  NOTE_INTERNAL_READ: "note.internal.read",
  NOTE_INTERNAL_WRITE: "note.internal.write",
  // Tasks (Phase 2)
  TASK_READ: "task.read",
  TASK_MANAGE: "task.manage",
  TASK_ASSIGN: "task.assign",
  // Dashboards
  DASHBOARD_SUPPORT: "dashboard.support",
  DASHBOARD_MANAGEMENT: "dashboard.management",
  // Administration
  ADMIN_CATEGORIES: "admin.categories",
  ADMIN_WORKFLOW: "admin.workflow",
  ADMIN_SLA: "admin.sla",
  ADMIN_ORG: "admin.org",
  ADMIN_TEAMS: "admin.teams",
  ADMIN_USERS: "admin.users",
  ADMIN_ROLES: "admin.roles",
  ADMIN_TENANTS: "admin.tenants",
  ADMIN_SETTINGS: "admin.settings",
  AUDIT_READ: "audit.read",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_META: Record<PermissionCode, { group: string; description: string }> = {
  "ticket.create": { group: "Tickets", description: "Create tickets" },
  "ticket.read.own": { group: "Tickets", description: "View own tickets (plus configured dept/branch scope)" },
  "ticket.read.team": { group: "Tickets", description: "View tickets owned by / supported by / assigned within own teams" },
  "ticket.read.all": { group: "Tickets", description: "View all tickets" },
  "ticket.update": { group: "Tickets", description: "Update ticket fields and status" },
  "ticket.assign": { group: "Tickets", description: "Assign / reassign agents within team" },
  "ticket.transfer": { group: "Tickets", description: "Transfer ticket to another team" },
  "ticket.escalate": { group: "Tickets", description: "Escalate tickets" },
  "ticket.confidential.read": { group: "Tickets", description: "View confidential tickets outside own involvement" },
  "ticket.closed.edit": { group: "Tickets", description: "Edit or reopen closed tickets" },
  "note.internal.read": { group: "Communication", description: "Read internal notes" },
  "note.internal.write": { group: "Communication", description: "Write internal notes" },
  "task.read": { group: "Tasks", description: "View tasks" },
  "task.manage": { group: "Tasks", description: "Create and update tasks" },
  "task.assign": { group: "Tasks", description: "Assign tasks to teams/agents" },
  "dashboard.support": { group: "Dashboards", description: "Support / team dashboards and admin portal access" },
  "dashboard.management": { group: "Dashboards", description: "Management dashboards across all tickets" },
  "admin.categories": { group: "Administration", description: "Manage categories, priorities and routing" },
  "admin.workflow": { group: "Administration", description: "Manage statuses and workflow transitions" },
  "admin.sla": { group: "Administration", description: "Manage SLA, business hours, holidays" },
  "admin.org": { group: "Administration", description: "Manage companies, departments, branches, locations" },
  "admin.teams": { group: "Administration", description: "Manage support teams and members" },
  "admin.users": { group: "Administration", description: "Manage users, role assignment, deactivation" },
  "admin.roles": { group: "Administration", description: "Manage roles and permissions" },
  "admin.tenants": { group: "Administration", description: "Manage Microsoft tenants / authorized organizations" },
  "admin.settings": { group: "Administration", description: "Manage system settings" },
  "audit.read": { group: "Administration", description: "View audit logs" },
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionCode[];

export const ROLE_CODES = {
  EMPLOYEE: "EMPLOYEE",
  SUPPORT_AGENT: "SUPPORT_AGENT",
  TEAM_LEAD: "TEAM_LEAD",
  SYSTEM_ADMIN: "SYSTEM_ADMIN",
  DASHBOARD_VIEWER: "DASHBOARD_VIEWER",
  OUTSOURCE_SUPPORT: "OUTSOURCE_SUPPORT",
  SUPER_ADMIN: "SUPER_ADMIN",
} as const;
export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

const P = PERMISSIONS;
const SUPPORT_BASE: PermissionCode[] = [
  P.TICKET_CREATE, P.TICKET_READ_OWN, P.TICKET_READ_TEAM, P.TICKET_UPDATE, P.TICKET_ASSIGN,
  P.NOTE_INTERNAL_READ, P.NOTE_INTERNAL_WRITE, P.TASK_READ, P.TASK_MANAGE, P.DASHBOARD_SUPPORT,
];

/** Default role → permissions mapping used by the seed. */
export const DEFAULT_ROLE_MATRIX: Record<RoleCode, { name: string; description: string; permissions: PermissionCode[] }> = {
  EMPLOYEE: {
    name: "Employee / User",
    description: "Create and follow own tickets; dept/branch visibility is configured per user",
    permissions: [P.TICKET_CREATE, P.TICKET_READ_OWN],
  },
  SUPPORT_AGENT: {
    name: "Support Agent",
    description: "Works tickets and tasks of own teams",
    permissions: SUPPORT_BASE,
  },
  TEAM_LEAD: {
    name: "Support Team Lead",
    description: "Manages team queue, assignment, transfer and escalation",
    permissions: [...SUPPORT_BASE, P.TICKET_TRANSFER, P.TICKET_ESCALATE, P.TASK_ASSIGN],
  },
  SYSTEM_ADMIN: {
    name: "System Admin",
    description: "Manages all tickets, configuration and users",
    permissions: ALL_PERMISSIONS.filter((p) => p !== P.ADMIN_TENANTS && p !== P.ADMIN_ROLES),
  },
  DASHBOARD_VIEWER: {
    name: "Dashboard Viewer",
    description: "Read-only management dashboards",
    permissions: [P.TICKET_CREATE, P.TICKET_READ_OWN, P.DASHBOARD_MANAGEMENT],
  },
  OUTSOURCE_SUPPORT: {
    name: "Outsource Support",
    description: "External vendor staff — only tickets/tasks of own team or assigned to them; no internal notes",
    permissions: [P.TICKET_READ_TEAM, P.TICKET_UPDATE, P.TASK_READ, P.TASK_MANAGE, P.DASHBOARD_SUPPORT],
  },
  SUPER_ADMIN: {
    name: "Super Admin",
    description: "Full control including tenants, roles and permissions",
    permissions: ALL_PERMISSIONS,
  },
};

/**
 * Permissions that may never be granted to users from VENDOR tenants, regardless
 * of role configuration. Enforced when the actor is loaded (defence in depth).
 */
export const VENDOR_FORBIDDEN_PERMISSIONS: PermissionCode[] = [
  P.TICKET_READ_ALL,
  P.TICKET_CONFIDENTIAL_READ,
  P.NOTE_INTERNAL_READ,
  P.NOTE_INTERNAL_WRITE,
  P.DASHBOARD_MANAGEMENT,
  P.ADMIN_CATEGORIES, P.ADMIN_WORKFLOW, P.ADMIN_SLA, P.ADMIN_ORG, P.ADMIN_TEAMS,
  P.ADMIN_USERS, P.ADMIN_ROLES, P.ADMIN_TENANTS, P.ADMIN_SETTINGS, P.AUDIT_READ,
];

/** Any of these grants entry into the /admin portal. */
export const ADMIN_PORTAL_PERMISSIONS: PermissionCode[] = [
  P.DASHBOARD_SUPPORT, P.DASHBOARD_MANAGEMENT, P.TICKET_READ_ALL,
  P.ADMIN_CATEGORIES, P.ADMIN_WORKFLOW, P.ADMIN_SLA, P.ADMIN_ORG, P.ADMIN_TEAMS,
  P.ADMIN_USERS, P.ADMIN_ROLES, P.ADMIN_TENANTS, P.ADMIN_SETTINGS, P.AUDIT_READ,
];
