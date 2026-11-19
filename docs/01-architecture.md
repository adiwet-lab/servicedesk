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
| Realtime (Phase 3) | Socket.IO on a custom Node server sharing the Next port; Redis adapter for scale-out (Azure Cache for Redis) |
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
