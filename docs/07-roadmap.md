# 07 · Implementation Roadmap

| Phase | Scope | Status |
|---|---|---|
| **1 – Foundation** | Project setup, DB + migrations + seed, Entra multi-tenant auth + dev login, tenant allow-list, user management, org structure, RBAC + data scope, Admin & User portals, dashboards (basic), ticket create/list/detail, categories, routing rules, support teams, basic workflow, attachments, in-app notifications (stored), audit log, settings, Docker | ✅ Delivered |
| **2 – Workflow** | Assignment/Reassignment/Transfer UI history panel (backend done), supporting teams, sub-tasks (create/assign/status/history/attachments), My/Team/All/Overdue Tasks views, task progress on ticket, required-task gating (validator done), task numbering (sequence seeded) | Next |
| **3 – Communication** | Socket.IO server + Redis adapter, ticket chat (public + internal notes), chat attachments, read/unread, unread counters, realtime notifications, chat search, notification settings; optional email/Teams channels | Planned |
| **4 – SLA** | SLA profile/target/business hours editors, pause/resume recalculation (`slaPausedMinutes` already tracked), warning & breach jobs, `SlaEvent` timeline, escalation rules execution, auto-close resolved tickets | Planned |
| **5 – Dashboard** | Management/Team/Agent dashboards with filters (date, company, dept, branch, team, category, priority, status, agent), ticket aging buckets (0–1, 2–3, 4–7, 8–14, >14 days), SLA performance, agent workload, exports | Planned |
| **6 – Advanced** | Major incident (parent/child, impacted branches/users, comms), impact scope, knowledge base (convert resolved tickets), Microsoft Teams & Graph integration (profile/org sync, Teams notifications), IT asset integration, approval workflow, Power BI dataset | Planned |

## Phase 2 entry criteria (from Phase 1)
- Schema already contains `TicketTask`, `TaskAssignment`, `TaskHistory`, `TicketSupportingTeam`, `NumberSequence(TASK)`.
- Scope already grants access via task team / task assignee / supporting team.
- Workflow validator already blocks RESOLVED with open required tasks.
