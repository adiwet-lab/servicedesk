# 07 · Implementation Roadmap

| Phase | Scope | Status |
|---|---|---|
| **1 – Foundation** | Project setup, DB + migrations + seed, Entra multi-tenant auth + dev login, tenant allow-list, user management, org structure, RBAC + data scope, Admin & User portals, dashboards (basic), ticket create/list/detail, categories, routing rules, support teams, basic workflow, attachments, in-app notifications (stored), audit log, settings, Docker | ✅ Delivered |
| **2 – Workflow** | Assignment/reassignment/transfer + escalation with full history, ticket field editing, main owner team + supporting teams, sub-tasks (create/assign/status/edit/history/attachments, required/optional, due dates), task drawer, My/Team/All/Overdue Tasks views, task progress, required-task resolution gating, unified filterable timeline, task KPIs | ✅ Delivered |
| **3 – Communication** | Socket.IO custom server (+ optional Redis adapter), ticket chat (public + internal notes), image/file attachments, read receipts & unread counters, Support Chat / Messages inboxes, chat search, realtime notifications & toasts, live ticket refresh, notification settings, first-response & requester-reply automation; email/Teams channels defined (delivery in Phase 6) | ✅ Delivered |
| **4 – SLA** | SLA profile/target/business hours editors, pause/resume recalculation (`slaPausedMinutes` already tracked), warning & breach jobs, `SlaEvent` timeline, escalation rules execution, auto-close resolved tickets | Next |
| **5 – Dashboard** | Management/Team/Agent dashboards with filters (date, company, dept, branch, team, category, priority, status, agent), ticket aging buckets (0–1, 2–3, 4–7, 8–14, >14 days), SLA performance, agent workload, exports | Planned |
| **6 – Advanced** | Major incident (parent/child, impacted branches/users, comms), impact scope, knowledge base (convert resolved tickets), Microsoft Teams & Graph integration (profile/org sync, Teams notifications), IT asset integration, approval workflow, Power BI dataset | Planned |

## Deferred from Phase 2
- "Task Overdue" notifications need the Phase 4 scheduled job runner (overdue tasks are highlighted and listed already).
- Category task templates (auto-create tasks from `Category.workflowRules`, e.g. the POS checklist) — candidate for a small follow-up.
