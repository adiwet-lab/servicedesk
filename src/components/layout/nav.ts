import type { Actor } from "@/server/authz/actor";
import { can, canAny, canAccessAdminPortal } from "@/server/authz/guards";
import { PERMISSIONS as P, type PermissionCode } from "@/server/authz/permissions";
import { availableViews } from "@/server/services/tickets";

export type IconName =
  | "dashboard" | "ticket" | "users" | "building" | "plus" | "bell" | "user" | "inbox" | "alert" | "clock" | "list"
  | "folder" | "flag" | "workflow" | "timer" | "calendar" | "route" | "map" | "briefcase" | "shield" | "key" | "cloud"
  | "file" | "settings" | "team" | "tasks" | "external";

export interface NavItem { label: string; href: string; icon: IconName; soon?: string }
export interface NavSection { title?: string; items: NavItem[] }

export function portalNav(actor: Actor): NavSection[] {
  const views = availableViews(actor);
  const items: NavItem[] = [{ label: "Dashboard", href: "/dashboard", icon: "dashboard" }];
  if (views.has("my")) items.push({ label: "My Tickets", href: "/tickets", icon: "ticket" });
  if (views.has("department")) items.push({ label: "Department Tickets", href: "/tickets/department", icon: "users" });
  if (views.has("branch")) items.push({ label: "Branch Tickets", href: "/tickets/branch", icon: "building" });
  if (can(actor, P.TICKET_CREATE)) items.push({ label: "Create Ticket", href: "/tickets/new", icon: "plus" });
  items.push({ label: "Notifications", href: "/notifications", icon: "bell" }, { label: "Profile", href: "/profile", icon: "user" });
  return [{ items }];
}

type Guarded = NavItem & { perm?: PermissionCode | PermissionCode[] };

export function adminNav(actor: Actor): NavSection[] {
  const sections: { title?: string; items: Guarded[] }[] = [
    { items: [{ label: "Dashboard", href: "/admin", icon: "dashboard" }] },
    {
      title: "Ticket Management",
      items: [
        { label: "All Tickets", href: "/admin/tickets?view=all", icon: "inbox", perm: [P.TICKET_READ_TEAM, P.TICKET_READ_ALL] },
        { label: "Unassigned Tickets", href: "/admin/tickets?view=unassigned", icon: "alert", perm: [P.TICKET_READ_TEAM, P.TICKET_READ_ALL] },
        { label: "My Team Tickets", href: "/admin/tickets?view=myteam", icon: "team", perm: [P.TICKET_READ_TEAM] },
        { label: "Assigned to Me", href: "/admin/tickets?view=assigned", icon: "user", perm: [P.TICKET_READ_TEAM, P.TICKET_READ_ALL] },
        { label: "Overdue Tickets", href: "/admin/tickets?view=overdue", icon: "clock", perm: [P.TICKET_READ_TEAM, P.TICKET_READ_ALL] },
        { label: "SLA Breached", href: "/admin/tickets?view=breached", icon: "flag", perm: [P.TICKET_READ_TEAM, P.TICKET_READ_ALL] },
      ],
    },
    {
      title: "Task Management",
      items: [
        { label: "All Tasks", href: "/admin/soon/all-tasks", icon: "tasks", perm: P.TASK_READ, soon: "P2" },
        { label: "My Tasks", href: "/admin/soon/my-tasks", icon: "tasks", perm: P.TASK_READ, soon: "P2" },
        { label: "Team Tasks", href: "/admin/soon/team-tasks", icon: "tasks", perm: P.TASK_READ, soon: "P2" },
        { label: "Overdue Tasks", href: "/admin/soon/overdue-tasks", icon: "clock", perm: P.TASK_READ, soon: "P2" },
      ],
    },
    {
      title: "Configuration",
      items: [
        { label: "Categories", href: "/admin/config/categories", icon: "folder", perm: P.ADMIN_CATEGORIES },
        { label: "Auto-assignment", href: "/admin/config/routing", icon: "route", perm: P.ADMIN_CATEGORIES },
        { label: "Priority", href: "/admin/config/priorities", icon: "flag", perm: P.ADMIN_CATEGORIES },
        { label: "Status", href: "/admin/config/statuses", icon: "list", perm: P.ADMIN_WORKFLOW },
        { label: "Workflow", href: "/admin/config/workflow", icon: "workflow", perm: P.ADMIN_WORKFLOW },
        { label: "SLA & Business Hours", href: "/admin/config/sla", icon: "timer", perm: P.ADMIN_SLA },
        { label: "Holidays", href: "/admin/config/holidays", icon: "calendar", perm: P.ADMIN_SLA },
        { label: "Escalation Rules", href: "/admin/soon/escalation-rules", icon: "alert", perm: P.ADMIN_SLA, soon: "P4" },
      ],
    },
    {
      title: "Organization",
      items: [
        { label: "Companies", href: "/admin/org/companies", icon: "briefcase", perm: P.ADMIN_ORG },
        { label: "Departments", href: "/admin/org/departments", icon: "users", perm: P.ADMIN_ORG },
        { label: "Branches", href: "/admin/org/branches", icon: "building", perm: P.ADMIN_ORG },
        { label: "Locations", href: "/admin/org/locations", icon: "map", perm: P.ADMIN_ORG },
        { label: "Employees", href: "/admin/system/users?type=INTERNAL", icon: "user", perm: P.ADMIN_USERS },
      ],
    },
    {
      title: "Support Management",
      items: [
        { label: "Support Teams", href: "/admin/support/teams", icon: "team", perm: P.ADMIN_TEAMS },
        { label: "Support Agents", href: "/admin/support/agents", icon: "users", perm: P.ADMIN_TEAMS },
        { label: "Outsource Teams", href: "/admin/support/outsource", icon: "external", perm: P.ADMIN_TEAMS },
      ],
    },
    {
      title: "System",
      items: [
        { label: "User Management", href: "/admin/system/users", icon: "users", perm: P.ADMIN_USERS },
        { label: "Roles", href: "/admin/system/roles", icon: "shield", perm: P.ADMIN_ROLES },
        { label: "Permissions", href: "/admin/system/permissions", icon: "key", perm: [P.ADMIN_ROLES, P.ADMIN_USERS] },
        { label: "Microsoft Tenants", href: "/admin/system/tenants", icon: "cloud", perm: P.ADMIN_TENANTS },
        { label: "Notification Settings", href: "/admin/soon/notification-settings", icon: "bell", perm: P.ADMIN_SETTINGS, soon: "P3" },
        { label: "Audit Logs", href: "/admin/system/audit", icon: "file", perm: P.AUDIT_READ },
        { label: "System Settings", href: "/admin/system/settings", icon: "settings", perm: P.ADMIN_SETTINGS },
      ],
    },
  ];
  return sections
    .map((s) => ({
      title: s.title,
      items: s.items
        .filter((i) => !i.perm || (Array.isArray(i.perm) ? canAny(actor, i.perm) : can(actor, i.perm)))
        .map((i) => ({ label: i.label, href: i.href, icon: i.icon, soon: i.soon })),
    }))
    .filter((s) => s.items.length > 0);
}

export { canAccessAdminPortal };
