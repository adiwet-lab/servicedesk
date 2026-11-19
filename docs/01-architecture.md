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
| Jobs (Phase 4) | `JobRunner` interface — in-process scheduler first, movable to Azure Functions / Container Apps Jobs |
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
