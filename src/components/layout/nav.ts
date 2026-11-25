import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { can, canAny, canAccessAdminPortal } from "@/server/authz/guards";
import { PERMISSIONS as P, type PermissionCode } from "@/server/authz/permissions";
import { availableViews } from "@/server/services/tickets";

export type IconName =
  | "dashboard" | "ticket" | "users" | "building" | "plus" | "bell" | "user" | "inbox" | "alert" | "clock" | "list"
  | "folder" | "flag" | "workflow" | "timer" | "calendar" | "route" | "map" | "briefcase" | "shield" | "key" | "cloud"
  | "file" | "settings" | "team" | "tasks" | "external" | "chat";

/** `label` / `title` are translation keys (messages: nav.*, navSection.*). */
export interface NavItem { label: string; href: string; icon: IconName; soon?: string; badge?: "messages" }
export interface NavSection { title?: string; items: NavItem[] }

export function portalNav(actor: Actor): NavSection[] {
  const views = availableViews(actor);
  const items: NavItem[] = [{ label: "nav.dashboard", href: "/dashboard", icon: "dashboard" }];
  // Phase 9: chat is the main way to report and follow up issues (it replaces the Messages inbox).
  if (can(actor, P.TICKET_CREATE) || views.has("my")) items.push({ label: "nav.chat", href: "/chat", icon: "chat", badge: "messages" });
  if (views.has("my")) items.push({ label: "nav.myTickets", href: "/tickets", icon: "ticket" });
  if (views.has("department")) items.push({ label: "nav.departmentTickets", href: "/tickets/department", icon: "users" });
  if (views.has("branch")) items.push({ label: "nav.branchTickets", href: "/tickets/branch", icon: "building" });
  if (can(actor, P.TICKET_CREATE)) items.push({ label: "nav.createTicket", href: "/tickets/new", icon: "plus" });
  items.push({ label: "nav.helpCenter", href: "/help", icon: "file" });
  if (!isVendor(actor)) items.push({ label: "nav.myApprovals", href: "/approvals", icon: "shield" });
  items.push({ label: "nav.notifications", href: "/notifications", icon: "bell" }, { label: "nav.profile", href: "/profile", icon: "user" });
  return [{ items }];
}

type Guarded = NavItem & { perm?: PermissionCode | PermissionCode[]; /** also visible to team leads */ whenLead?: boolean };

export function adminNav(actor: Actor): NavSection[] {
  const sections: { title?: string; items: Guarded[] }[] = [
    {
      title: "navSection.dashboardsReports",
      items: [
        { label: "nav.dashboard", href: "/admin", icon: "dashboard" },
        { label: "nav.slaDashboard", href: "/admin/dashboards/sla", icon: "timer", perm: [P.DASHBOARD_SUPPORT, P.DASHBOARD_MANAGEMENT, P.TICKET_READ_ALL] },
        { label: "nav.ticketAging", href: "/admin/dashboards/aging", icon: "clock", perm: [P.DASHBOARD_SUPPORT, P.DASHBOARD_MANAGEMENT, P.TICKET_READ_ALL] },
        { label: "nav.workload", href: "/admin/dashboards/workload", icon: "team", perm: [P.DASHBOARD_MANAGEMENT, P.TICKET_READ_ALL], whenLead: true },
        { label: "nav.reports", href: "/admin/reports", icon: "file", perm: P.REPORT_EXPORT },
      ],
    },
    {
      title: "navSection.ticketManagement",
      items: [
        { label: "nav.allTickets", href: "/admin/tickets?view=all", icon: "inbox", perm: [P.TICKET_READ_TEAM, P.TICKET_READ_ALL] },
        { label: "nav.unassignedTickets", href: "/admin/tickets?view=unassigned", icon: "alert", perm: [P.TICKET_READ_TEAM, P.TICKET_READ_ALL] },
        { label: "nav.myTeamTickets", href: "/admin/tickets?view=myteam", icon: "team", perm: [P.TICKET_READ_TEAM] },
        { label: "nav.assignedToMe", href: "/admin/tickets?view=assigned", icon: "user", perm: [P.TICKET_READ_TEAM, P.TICKET_READ_ALL] },
        { label: "nav.overdueTickets", href: "/admin/tickets?view=overdue", icon: "clock", perm: [P.TICKET_READ_TEAM, P.TICKET_READ_ALL] },
        { label: "nav.slaBreached", href: "/admin/tickets?view=breached", icon: "flag", perm: [P.TICKET_READ_TEAM, P.TICKET_READ_ALL] },
        { label: "nav.majorIncidents", href: "/admin/incidents", icon: "alert", perm: [P.INCIDENT_MANAGE, P.DASHBOARD_SUPPORT, P.DASHBOARD_MANAGEMENT, P.TICKET_READ_ALL] },
        { label: "nav.knowledgeBase", href: "/admin/kb", icon: "file", perm: [P.KB_WRITE, P.KB_PUBLISH] },
        { label: "nav.supportChat", href: "/admin/chat", icon: "chat", perm: [P.TICKET_READ_TEAM, P.TICKET_READ_ALL], badge: "messages" },
      ],
    },
    {
      title: "navSection.taskManagement",
      items: [
        { label: "nav.allTasks", href: "/admin/tasks?view=all", icon: "tasks", perm: P.TICKET_READ_ALL },
        { label: "nav.myTasks", href: "/admin/tasks?view=my", icon: "tasks", perm: P.TASK_READ },
        { label: "nav.teamTasks", href: "/admin/tasks?view=team", icon: "team", perm: P.TASK_READ },
        { label: "nav.overdueTasks", href: "/admin/tasks?view=overdue", icon: "clock", perm: P.TASK_READ },
      ],
    },
    {
      title: "navSection.configuration",
      items: [
        { label: "nav.categories", href: "/admin/config/categories", icon: "folder", perm: P.ADMIN_CATEGORIES },
        { label: "nav.autoAssignment", href: "/admin/config/routing", icon: "route", perm: P.ADMIN_CATEGORIES },
        { label: "nav.priority", href: "/admin/config/priorities", icon: "flag", perm: P.ADMIN_CATEGORIES },
        { label: "nav.status", href: "/admin/config/statuses", icon: "list", perm: P.ADMIN_WORKFLOW },
        { label: "nav.workflow", href: "/admin/config/workflow", icon: "workflow", perm: P.ADMIN_WORKFLOW },
        { label: "nav.approvalPolicies", href: "/admin/config/approvals", icon: "shield", perm: P.ADMIN_WORKFLOW },
        { label: "nav.slaProfiles", href: "/admin/config/sla", icon: "timer", perm: P.ADMIN_SLA },
        { label: "nav.businessHours", href: "/admin/config/business-hours", icon: "clock", perm: P.ADMIN_SLA },
        { label: "nav.holidays", href: "/admin/config/holidays", icon: "calendar", perm: P.ADMIN_SLA },
        { label: "nav.escalationRules", href: "/admin/config/escalations", icon: "alert", perm: P.ADMIN_SLA },
      ],
    },
    {
      title: "navSection.organization",
      items: [
        { label: "nav.companies", href: "/admin/org/companies", icon: "briefcase", perm: P.ADMIN_ORG },
        { label: "nav.departments", href: "/admin/org/departments", icon: "users", perm: P.ADMIN_ORG },
        { label: "nav.branches", href: "/admin/org/branches", icon: "building", perm: P.ADMIN_ORG },
        { label: "nav.locations", href: "/admin/org/locations", icon: "map", perm: P.ADMIN_ORG },
        { label: "nav.employees", href: "/admin/system/users?type=INTERNAL", icon: "user", perm: P.ADMIN_USERS },
      ],
    },
    {
      title: "navSection.supportManagement",
      items: [
        { label: "nav.supportTeams", href: "/admin/support/teams", icon: "team", perm: P.ADMIN_TEAMS },
        { label: "nav.supportAgents", href: "/admin/support/agents", icon: "users", perm: P.ADMIN_TEAMS },
        { label: "nav.outsourceTeams", href: "/admin/support/outsource", icon: "external", perm: P.ADMIN_TEAMS },
      ],
    },
    {
      title: "navSection.system",
      items: [
        { label: "nav.userManagement", href: "/admin/system/users", icon: "users", perm: P.ADMIN_USERS },
        { label: "nav.roles", href: "/admin/system/roles", icon: "shield", perm: P.ADMIN_ROLES },
        { label: "nav.permissions", href: "/admin/system/permissions", icon: "key", perm: [P.ADMIN_ROLES, P.ADMIN_USERS] },
        { label: "nav.microsoftTenants", href: "/admin/system/tenants", icon: "cloud", perm: P.ADMIN_TENANTS },
        { label: "nav.notificationSettings", href: "/admin/system/notifications", icon: "bell", perm: P.ADMIN_SETTINGS },
        { label: "nav.integrations", href: "/admin/integrations", icon: "external", perm: P.INTEGRATIONS_MANAGE },
        { label: "nav.auditLogs", href: "/admin/system/audit", icon: "file", perm: P.AUDIT_READ },
        { label: "nav.accessReview", href: "/admin/system/access-review", icon: "shield", perm: P.ADMIN_USERS },
        { label: "nav.systemSettings", href: "/admin/system/settings", icon: "settings", perm: P.ADMIN_SETTINGS },
      ],
    },
  ];
  return sections
    .map((s) => ({
      title: s.title,
      items: s.items
        .filter((i) => !i.perm || (Array.isArray(i.perm) ? canAny(actor, i.perm) : can(actor, i.perm)) || (i.whenLead && actor.leadTeamIds.length > 0))
        .map((i) => ({ label: i.label, href: i.href, icon: i.icon, soon: i.soon, badge: i.badge })),
    }))
    .filter((s) => s.items.length > 0);
}

export { canAccessAdminPortal };
