# 04 · Role & Permission Matrix

Permissions are code-defined in [`src/server/authz/permissions.ts`](../src/server/authz/permissions.ts) and synced to the `Permission` table by the seed.
Role → permission mappings below are the **seeded defaults**; System/Super Admins can change them in *Admin → System → Roles* (live matrix: *Admin → System → Permissions*).

Authorization = **permission** (what) × **data scope** (which rows). Both are enforced server-side in services; the UI only hides what the server would refuse anyway.

## Default matrix
✱ = never granted to users of external (VENDOR) tenants, regardless of role (stripped when the actor is loaded).

| Permission | Employee / User | Support Agent | Support Team Lead | System Admin | Dashboard Viewer | Outsource Support | Super Admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `ticket.create` — Create tickets | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `ticket.read.own` — View own tickets (plus configured dept/branch scope) | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `ticket.read.team` — View tickets owned by / supported by / assigned within own teams |  | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `ticket.read.all` ✱ — View all tickets |  |  |  | ✓ |  |  | ✓ |
| `ticket.update` — Update ticket fields and status |  | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `ticket.assign` — Assign / reassign agents within team |  | ✓ | ✓ | ✓ |  |  | ✓ |
| `ticket.transfer` — Transfer ticket to another team |  |  | ✓ | ✓ |  |  | ✓ |
| `ticket.escalate` — Escalate tickets |  |  | ✓ | ✓ |  |  | ✓ |
| `ticket.confidential.read` ✱ — View confidential tickets outside own involvement |  |  |  | ✓ |  |  | ✓ |
| `ticket.closed.edit` — Edit or reopen closed tickets |  |  |  | ✓ |  |  | ✓ |
| `note.internal.read` ✱ — Read internal notes |  | ✓ | ✓ | ✓ |  |  | ✓ |
| `note.internal.write` ✱ — Write internal notes |  | ✓ | ✓ | ✓ |  |  | ✓ |
| `task.read` — View tasks |  | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `task.manage` — Create and update tasks |  | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `task.assign` — Assign tasks to teams/agents |  |  | ✓ | ✓ |  |  | ✓ |
| `dashboard.support` — Support / team dashboards and admin portal access |  | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `dashboard.management` ✱ — Management dashboards across all tickets |  |  |  | ✓ | ✓ |  | ✓ |
| `admin.categories` ✱ — Manage categories, priorities and routing |  |  |  | ✓ |  |  | ✓ |
| `admin.workflow` ✱ — Manage statuses and workflow transitions |  |  |  | ✓ |  |  | ✓ |
| `admin.sla` ✱ — Manage SLA, business hours, holidays |  |  |  | ✓ |  |  | ✓ |
| `admin.org` ✱ — Manage companies, departments, branches, locations |  |  |  | ✓ |  |  | ✓ |
| `admin.teams` ✱ — Manage support teams and members |  |  |  | ✓ |  |  | ✓ |
| `admin.users` ✱ — Manage users, role assignment, deactivation |  |  |  | ✓ |  |  | ✓ |
| `admin.roles` ✱ — Manage roles and permissions |  |  |  |  |  |  | ✓ |
| `admin.tenants` ✱ — Manage Microsoft tenants / authorized organizations |  |  |  |  |  |  | ✓ |
| `admin.settings` ✱ — Manage system settings |  |  |  | ✓ |  |  | ✓ |
| `audit.read` ✱ — View audit logs |  |  |  | ✓ |  |  | ✓ |

## Data scope (row-level)
`ticketScopeWhere(actor)` — a ticket is visible if **any** applies:

| Grant | Condition |
|---|---|
| `ticket.read.all` (internal only) | every ticket |
| `ticket.read.own` | requester = me |
| … + user visibility `OWN_DEPT` / `OWN_BRANCH` / `OWN_DEPT_BRANCH` (internal only) | same department / branch as me |
| `ticket.read.team` | owner team ∈ my teams, or a supporting team ∈ my teams, or a task's team ∈ my teams |
| support staff | I am the assigned agent of the ticket or one of its tasks |

**Confidential tickets** (unless `ticket.confidential.read` and internal): only requester, assigned agent and owner-team members.

## Action rules
| Action | Rule |
|---|---|
| View ticket | scope above |
| Work ticket (status/fields as staff) | `ticket.update` **and** (read.all, or assigned to me, or owner team ∈ my teams) |
| Assign agent | `ticket.assign` and owner team ∈ my teams (or read.all); internal users only; agent must be an active team member |
| Transfer to another team | additionally `ticket.transfer` (or read.all) + mandatory reason |
| Requester actions | only transitions flagged *requester allowed* (cancel, close resolved, reopen within window) |
| Closed/Cancelled tickets | read-only unless `ticket.closed.edit` |
| Grant roles / permissions | admin may only grant roles/permissions they hold (no privilege escalation); cannot remove own roles or deactivate self |
| Create task | `task.manage` + can work the ticket |
| Work a task (fields/status) | `task.manage` + task team member / task assignee / owner-team staff / admin |
| Assign task to others / move team | `task.assign` + can work the ticket or leads the task's team (internal only); otherwise self-assign within own team |
| Reopen task, change required flag | owner side only (never vendors / other task teams) |
| Edit ticket fields | can work the ticket (internal only) |
| Escalate | `ticket.escalate` + can work the ticket (internal only) |
| Supporting teams add/remove | same as assign (`ticket.assign` within owner team, or read.all) |
| Task visibility | parent ticket visible; vendors only their own team's / own tasks |
| Read public chat | anyone who can see the ticket (incl. dept/branch observers) |
| Post public chat message | requester, staff who can work the ticket, task team members/assignees; not observers; closed tickets read-only (except `ticket.closed.edit`) |
| Internal notes | read `note.internal.read`, write `note.internal.write`; internal tenants only; filtered in every query (`messageScopeWhere`) incl. search, inbox previews, unread counts, attachment downloads and realtime rooms |

## Role intent
| Role | Typical user | Portal |
|---|---|---|
| Employee / User | staff of internal companies | User Portal |
| Support Agent | IT engineer in one or more teams | Admin/Support Portal + User Portal |
| Support Team Lead | queue owner; assigns, transfers, escalates | Admin/Support Portal |
| System Admin | IT service management admin (no tenant/role admin) | Admin Portal |
| Dashboard Viewer | management | Management dashboard |
| Outsource Support | vendor engineer (external tenant) | Support Portal, team-scoped |
| Super Admin | platform owner incl. tenants, roles | everything |
