# Enterprise IT Service Desk

Multi-tenant IT Service Desk & Ticket Management System — Next.js 15 · TypeScript · Tailwind/shadcn-ui · PostgreSQL/Prisma · Microsoft Entra ID (multi-tenant OIDC).

Two portals:
- **User Portal** (`/dashboard`, `/tickets…`) — employees create and follow tickets.
- **Admin / IT Support Portal** (`/admin…`) — agents, team leads, outsource vendors and administrators.

> **Status: Phase 1 (Foundation) and Phase 2 (Workflow: tasks, multi-team, assignment, escalation, history) delivered.** See [docs/07-roadmap.md](docs/07-roadmap.md) for Phases 3–6.

## Documentation
| Doc | Contents |
|---|---|
| [01-architecture](docs/01-architecture.md) | System architecture, layering rules, Azure deployment |
| [02-erd](docs/02-erd.md) | ER diagram, table map, constraints & indexes |
| [03-auth-multitenant](docs/03-auth-multitenant.md) | Entra ID multi-tenant sign-in, tenant gate, session revocation |
| [04-rbac-matrix](docs/04-rbac-matrix.md) | Role × permission matrix, data-scope rules |
| [05-workflows](docs/05-workflows.md) | Ticket & task workflows, routing, assignment |
| [06-security](docs/06-security.md) | Risk register & mitigations |
| [07-roadmap](docs/07-roadmap.md) | Phased implementation plan |

---

## Quick start (local)

Prerequisites: Node.js 22+, pnpm 10+, PostgreSQL 16 (or Docker).

```bash
pnpm install
```

```bash
cp .env.example .env
```

Edit `.env`: set `DATABASE_URL`, generate `AUTH_SECRET` (`openssl rand -base64 33`), and set `AUTH_DEV_LOGIN=true` to sign in without Microsoft during development.

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

```bash
pnpm db:demo
```

(`db:demo` is optional; it creates sample tickets through the real service layer, plus the multi-team example "Branch POS cannot operate" with tasks for Infrastructure, Retail, ERP and Vendor B. It is idempotent.)

```bash
pnpm dev
```

Open http://localhost:3000 and use **Developer login** to pick a demo user:

| Demo user | Role | Shows |
|---|---|---|
| Emma Employee | Employee (own tickets) | User portal, create ticket |
| Ethan Employee | Employee (own + department) | Department Tickets |
| Somchai Store | Employee (own + branch) | Branch Tickets |
| Ana Agent | Support Agent – IT Support | Team queue, workflow |
| Lee Lead | Team Lead – IT Support | Assign / transfer / escalate / tasks |
| Ivan Infra / Rita Retail / Erin ERP | Leads/agents of Infrastructure, Retail, ERP | Team Tasks, multi-team POS demo |
| Victor VendorA / Vera VendorB | Outsource Support (external tenants, expiring) | Team-scoped vendor access |
| Mia Manager | Dashboard Viewer | Management dashboard |
| Alex Admin | System Admin | Configuration, users |
| Sam Super | Super Admin | + tenants, roles |

### Docker
```bash
cp .env.example .env.docker
```
Set `AUTH_SECRET` (and Entra values) in `.env.docker`, then:
```bash
docker compose up --build
```
`migrate` runs `prisma migrate deploy` + idempotent seed, then `app` starts on :3000. Add `--profile azurite` and `STORAGE_DRIVER=azure` to test Blob storage locally. Note: the dev login is disabled in the container (production mode) — configure Entra ID.

---

## Microsoft Entra ID setup
1. **Entra admin center → App registrations → New registration**
   - Supported account types: **Accounts in any organizational directory (Multitenant)**
   - Redirect URI (Web): `https://<your-host>/api/auth/callback/microsoft-entra-id` (and `http://localhost:3000/...` for dev)
2. **Certificates & secrets** → new client secret.
3. **API permissions**: Microsoft Graph delegated `openid`, `profile`, `email` (default).
4. Set `AUTH_MICROSOFT_ENTRA_ID_ID` (Application/client ID) and `AUTH_MICROSOFT_ENTRA_ID_SECRET`.
5. For each organization (internal domains and vendors): an admin of that tenant grants consent
   `https://login.microsoftonline.com/<their-tenant-id>/adminconsent?client_id=<client-id>`,
   then add the **Tenant ID** under **Admin → System → Microsoft Tenants** (type Internal/Vendor, auto-provision, default role).
6. The seeded demo tenants use placeholder GUIDs — replace them with your real tenant IDs.

Only active tenants in that list can sign in. Users are identified by **(Tenant ID, Object ID)**; email domains are never used for authorization.

---

## Testing
```bash
pnpm typecheck
```
```bash
pnpm lint
```
```bash
pnpm test:unit
```
Unit tests (pure logic, no DB): scope/RBAC, workflow, routing, numbering, business-hours SLA, upload validation, Entra claims.

```bash
pnpm test:integration
```
Integration tests run the services against a **fresh throwaway PostgreSQL database per run**: created via `TEST_DATABASE_ADMIN_URL` (default `postgresql://servicedesk:servicedesk@localhost:5432/postgres`, user needs `CREATEDB`), migrated with `prisma migrate deploy`, seeded, then dropped. Set `KEEP_TEST_DB=1` to keep it. Covered (Phase 2): task numbering, supporting-team auto-add, vendor task isolation, requester read-only tasks, self-assign vs `task.assign`, reasons, reopen rules, task attachment authorization, required-task resolution gating, task list scopes, frozen tasks on closed tickets, ticket field edits + SLA recalculation, supporting-team removal guard, escalation rules. Covered (Phase 1): routing, numbering under concurrency, required fields, data scope (own/dept/confidential/vendor isolation), attachment authorization, workflow and assignment rules, append-only audit trigger, deactivation/expiry/session revocation, vendor permission stripping, privilege escalation, tenant gate.

```bash
pnpm test:e2e
```
Playwright E2E (12 tests) against `pnpm dev` (reuses a running server on :3000) with the seeded database: create ticket → agent workflow (reason/resolution enforced) → requester closes → cross-user access denied; admin adds a subcategory; employee blocked from admin; deactivated user signed out immediately; multi-team task flow (lead creates Infrastructure task → resolve blocked → Infrastructure lead completes it from Team Tasks → resolve succeeds → requester sees progress read-only; vendor denied).

---

## Project structure
```
prisma/            schema.prisma · migrations/ (incl. audit trigger) · seed.ts · seed-demo.ts
src/app/
  (auth)/login     Microsoft + developer sign-in
  (portal)/        User Portal: dashboard, tickets (my/department/branch/new/[number]), notifications, profile, search
  admin/           Admin Portal: dashboard, tickets, config/*, org/*, support/*, system/*
  api/             auth callback · attachments/[id] (scope-checked download) · health
src/server/
  auth/            Auth.js config · tenant gate · per-request actor
  authz/           permission catalog · guards · data-scope builders · errors
  domain/          workflow rules · routing · business-hours calendar (pure, unit-tested)
  services/        tickets · notifications · settings · numbering · sla · audit · dashboard · admin/*
  storage/         local disk · Azure Blob · upload validation
  actions/         Server Actions (thin adapters)
src/components/    ui/ (shadcn-style) · layout/ · tickets/ · admin/ · dashboard/
tests/             unit/ · integration/ · e2e/
docs/              design package
```

## Configuration managed in the Admin Portal (no code changes)
Categories/subcategories (default team, priority, SLA, required fields, active), auto-assignment rules, priorities, statuses (kind, colour, reason, SLA pause), workflow transitions (permission, requester-allowed, comment), holidays, companies/departments/branches/locations, support teams & members (internal/vendor/outsource), users (roles, org mapping, ticket visibility, status, access expiry), roles & permissions, Microsoft tenants, ticket/task number format, upload limits & file types, reopen window, fallback team, default priority.
