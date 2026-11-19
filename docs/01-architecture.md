# 01 · System Architecture

## Goals
Enterprise IT Service Desk for multiple companies, departments, branches, internal IT teams and external vendors, with Microsoft 365 (Entra ID) multi-tenant sign-in, strict server-side authorization, configurable catalog/workflow/SLA, and an Azure-ready deployment.

## Shape: modular monolith on Next.js
```
Browser ──HTTPS──▶ Next.js (App Router, React Server Components)
                     │
                     ├─ app/(portal)/*        User Portal pages (RSC)
                     ├─ app/admin/*           Admin / IT Support Portal pages (RSC)
                     ├─ server/actions/*      Server Actions = thin adapters (parse form → call service)
                     ├─ app/api/*             Route handlers (auth callback, attachment download, health)
                     │
                     ├─ server/services/*     ◀── ALL business logic; every function takes an Actor and authorizes
                     ├─ server/domain/*       Pure logic: workflow rules, routing, business-hours SLA calendar
                     ├─ server/authz/*        Permission catalog, guards, data-scope WHERE builders
                     ├─ server/auth/*         Auth.js config, Entra tenant gate, per-request Actor loading
                     ├─ server/storage/*      StorageProvider: LocalDisk | Azure Blob (Azurite-compatible)
                     └─ server/db.ts          Prisma client ──▶ PostgreSQL
```
**Rules of the codebase**
1. UI never queries the database for protected data directly — it calls services.
2. Every service function receives an `Actor` (reloaded from DB each request) and enforces permission + data scope itself.
3. Every ticket read is `AND`ed with `ticketScopeWhere(actor)`.
4. Every mutation writes `AuditLog` (and `TicketHistory` for ticket changes) inside the same transaction.
5. Behaviour keys off configuration (status *kind*, permission codes, settings) — never hard-coded names.

## Technology
| Concern | Choice |
|---|---|
| Web | Next.js 15 (App Router, RSC, Server Actions), TypeScript strict |
| UI | Tailwind CSS v4 + shadcn/ui-style components (Radix primitives), lucide icons, Recharts |
| Data | PostgreSQL 16, Prisma 6 (migrations + typed client) |
| Auth | Auth.js v5 — Microsoft Entra ID (OIDC, multi-tenant) + dev-only credentials provider |
| Validation | zod (shared by forms and services) |
| Files | `StorageProvider` → local disk (dev) / Azure Blob Storage (prod) |
| Realtime | Socket.IO on a custom Node server (`server.ts`) sharing the Next port; optional Redis adapter (`REDIS_URL`) for scale-out (Azure Cache for Redis) |
| Jobs | In-process `JobRunner` (server.ts, every `JOBS_INTERVAL_SECONDS`) guarded by a database lease; `pnpm jobs:run` for Azure Container Apps Jobs / Functions / cron |
| Tests | Vitest (unit + integration with throwaway DB), Playwright (E2E) |
| Deploy | Docker multi-stage (Next standalone), docker-compose for local; Azure Container Apps / App Service + Azure Database for PostgreSQL Flexible Server + Blob Storage + Key Vault |

## Azure reference deployment
```
Front Door / App Gateway (WAF, TLS) ─▶ Container Apps (app, N replicas) ─▶ PostgreSQL Flexible Server (private endpoint)
                                            │                         └▶ Blob Storage (private container, managed identity)
                                            ├▶ Key Vault (AUTH_SECRET, Entra client secret, DB password)
                                            ├▶ Azure Cache for Redis (Phase 3 Socket.IO adapter, rate limiting)
                                            └▶ Application Insights (logs, traces)
Container Apps Job: `migrator` image target → `prisma migrate deploy && seed` on each release
```

## Scalability notes
- Stateless app instances (JWT session cookie; actor reloaded from DB per request) → horizontal scale.
- Rate limiter and (Phase 3) realtime fan-out move to Redis when running >1 replica.
- Hot list queries are index-backed (`status`, `ownerTeamId`, `assignedAgentId`, `requesterId`, `departmentId`, `branchId`, `createdAt`, `resolutionDueAt`).
- Dashboards use `groupBy` aggregations; Phase 5 adds materialised daily snapshots for large datasets / Power BI.

## Realtime architecture (Phase 3)
```
Browser ──socket.io (same origin, session cookie)──▶ server.ts ── Socket.IO server (src/server/realtime/socket-server.ts)
   ▲                                                     │  auth: Origin allow-list + Auth.js JWT (decode) + loadActor()
   │ server actions (authorized re-fetch)                │  rooms: user:{id} · ticket:{id} · ticket:{id}:internal
   └──────────────── Next.js ── services ── transaction() ──▶ bus.queueEvent() ──(after COMMIT)──▶ io.to(room).emit(signal)
```
- **Signals, not data.** Events are `{ticketId, messageId?}` / `{type, title}`; clients re-fetch through server actions that re-run `ticketScopeWhere` + `messageScopeWhere`. Internal-note content never travels over sockets and permission changes apply immediately.
- **After-commit delivery.** `src/server/db-tx.ts#transaction()` collects events queued inside a transaction and emits them only after COMMIT (dropped on rollback).
- **Room authorization.** `ticket:join` re-loads the actor (status, tenant, expiry, session version) and checks `ticketScopeWhere`; the internal room requires `note.internal.read` and an internal tenant. Sockets are re-validated every 5 minutes; deactivation / "sign out everywhere" pushes `session:revoked`.
- `audit()` emits a data-less `ticket:changed` for every audited ticket mutation so open ticket pages refresh live (internal-note events go to the internal room only).
- **Production:** `pnpm build` = `next build` + esbuild bundle of `server.ts` → `dist/server.js`; `pnpm start` runs it. The reverse proxy (Front Door / App Gateway / Container Apps ingress) must allow WebSocket upgrades on `/socket.io`. For >1 replica set `REDIS_URL` (sticky sessions not required with the websocket transport; enable them if the polling fallback is needed).

## SLA engine & scheduled jobs (Phase 4)
- **Pure clock engine** (`src/server/domain/sla-engine.ts`): business-minute arithmetic (timezone, working windows incl. split shifts, holidays) and clock evaluation. Both clocks share one pause ledger per ticket: `dueAt = addBusinessMinutes(createdAt, target + pausedBusinessMinutes)`.
- **Target snapshot** on the ticket (`responseTargetMin`, `resolutionTargetMin`, `slaBusinessHours`) so profile edits don't retroactively change open tickets; re-snapshotted on priority/category change and escalation.
- **Event-driven updates** in services (`applyStatusChange`, `recordFirstResponse`) inside the same transaction as the status change; every clock transition is an `SlaEvent`.
- **Sweep job** (`src/server/jobs/sla-sweep.ts`): warnings, breaches, escalation rules, overdue-task notifications, auto-close, backfill. Idempotent (effects recorded as events/flags), one item per transaction, multi-instance safe via a lease row in `SystemSetting` (atomic `INSERT … ON CONFLICT … WHERE expired`). System actions are audited with actor = System (null).

## Analytics & reporting (Phase 5)
- `src/server/services/analytics.ts` builds every figure from **one where-clause**: `scope ∧ dimension filters ∧ date window`. Scope is organisation-wide only for management roles (`dashboard.management` / `ticket.read.all`, never vendors); everyone else gets the same `ticketScopeWhere` used by ticket lists, so dashboards can never reveal tickets a user couldn't open.
- Counts use Prisma `groupBy`/`count`; time series and durations use bounded timestamp queries (50k rows, flagged when capped) bucketed by pure helpers (`src/server/domain/analytics.ts`).
- Cohorts: volume = tickets **created** in the period (current status); compliance & average times = tickets **resolved** in the period; aging, workload and open-ticket SLA states = **current backlog**.
- Reports (`services/reports.ts`, `GET /api/reports/[type]`) reuse the same filters/scope, require `report.export`, cap at 50k rows, write UTF-8 BOM CSV with formula-injection escaping, and are audited.
- For very large datasets, Phase 6 adds a Power BI dataset / snapshot tables; Phase 5 queries live data.

## Advanced features & integrations (Phase 6)
- Services: `incidents.ts`, `kb.ts`, `approvals.ts`; pure rules in `domain/impact.ts`, `domain/approvals.ts`, `lib/markdown.ts`.
- `src/server/integrations/`: `crypto.ts` (AES-GCM secrets, token hashing, pseudonyms) · `ssrf.ts` (outbound allow-list) · `http.ts` (timeouts, no redirects, size cap, Retry-After) · `outbox.ts` · `teams.ts` · `graph.ts` · `assets.ts` (AssetProvider: demo / REST) · `bi.ts`.
- Job runner tick = SLA sweep → outbox delivery → due Graph syncs (each behind its own database lease). `pnpm jobs:run` runs all three once.
- Power BI feeds are plain route handlers (`/api/bi/v1/[feed]`) authenticated by bearer token, excluded from the session middleware.
