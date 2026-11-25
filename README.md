# Enterprise IT Service Desk

Multi-tenant IT Service Desk & Ticket Management System — Next.js 15 · TypeScript · Tailwind/shadcn-ui · PostgreSQL/Prisma · Microsoft Entra ID (multi-tenant OIDC).

Two portals:
- **User Portal** (`/dashboard`, `/tickets…`) — employees create and follow tickets.
- **Admin / IT Support Portal** (`/admin…`) — agents, team leads, outsource vendors and administrators.

> **Status: Phases 1–7 delivered** (Phase 7: production hardening — nonce CSP, distributed rate limits, access review, audit export, malware-scan gate, container hardening) — Foundation; Workflow (tasks, multi-team, assignment, escalation, history); Communication (realtime chat, internal notes, attachments, unread, realtime notifications); SLA (business-hours clocks, pause, warning/breach, escalation rules, auto-close); Dashboards & Reports; Advanced (major incidents & branch impact, knowledge base, approval workflow, Microsoft Graph directory sync, Microsoft Teams channel cards, IT asset lookup, Power BI feeds). See [docs/07-roadmap.md](docs/07-roadmap.md).

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

`pnpm dev` runs the custom server (`server.ts`: Next.js + Socket.IO realtime on one port). Production: `pnpm build && pnpm start`. Behind a reverse proxy, allow WebSocket upgrades on `/socket.io`; for several instances set `REDIS_URL`. The server also runs the SLA job every minute (`JOBS_ENABLED`, `JOBS_INTERVAL_SECONDS`); `pnpm jobs:run` runs one sweep for external schedulers.

Open http://localhost:3000 and use **Developer login** to pick a demo user:

| Demo user | Role | Shows |
|---|---|---|
| Emma Employee | Employee (own tickets) | User portal, create ticket |
| Ethan Employee | Employee (own + department), Emma's manager | Department Tickets, **My Approvals** |
| Somchai Store | Employee (own + branch) | Branch Tickets |
| Ana Agent | Support Agent – IT Support | Team queue, workflow |
| Lee Lead | Team Lead – IT Support | Assign / transfer / escalate / tasks |
| Ivan Infra / Rita Retail / Erin ERP | Leads/agents of Infrastructure, Retail, ERP | Team Tasks, multi-team POS demo |
| Victor VendorA / Vera VendorB | Outsource Support (external tenants, expiring) | Team-scoped vendor access |
| Mia Manager | Dashboard Viewer | Management dashboard |
| Alex Admin | System Admin | Configuration, users, integrations, approval policies |
| Sam Super | Super Admin | + tenants, roles |

### Phase 6 walkthrough
- **Major incident**: as Lee Lead open a ticket → *Set impact* (Multiple branches: Siam + Chiang Mai) → *Declare major incident*. As Somchai Store the dashboard shows the *Known issue* banner → *I'm affected too*. Lee posts updates and resolves (cascade). Overview: **Admin → Major Incidents**.
- **Knowledge base**: **Help Center** in the portal (try "VPN" or "รหัสผ่าน"); suggestions appear while typing a ticket subject. Agents: *Create knowledge article* on a resolved ticket; leads publish in **Admin → Knowledge Base**.
- **Approvals**: Emma creates *IT Request › Hardware Request* → pending, SLA paused, agents can only cancel. Ethan approves in **My Approvals**. Policies: **Admin → Configuration → Approval Policies**.
- **Integrations**: **Admin → System → Integrations** (Graph sync, Teams webhooks per team, asset provider with a test lookup, Power BI tokens, delivery log). The demo asset provider knows e.g. `POS-BKK01-03`, `PRN-HQ-F5-02`.

### Docker
```bash
cp .env.example .env.docker
```
Set `AUTH_SECRET` (and Entra values) in `.env.docker`, then:
```bash
docker compose up --build
```
`migrate` runs `prisma migrate deploy` + idempotent seed, then `app` starts on :3000 (read-only root filesystem, no capabilities, healthcheck on `/api/ready`). Add `--profile azurite` and `STORAGE_DRIVER=azure` to test Blob storage locally. Note: the dev login is disabled in the container (production mode) — configure Entra ID.

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

## Production checklist
- `NODE_ENV=production`, `AUTH_DEV_LOGIN` unset, `AUTH_SECRET` and `INTEGRATIONS_KEY` from Key Vault.
- `REDIS_URL` when running more than one instance; `TRUST_PROXY_HOPS=1` behind Front Door / App Gateway.
- Probes: liveness `/api/health`, readiness `/api/ready`.
- Optional: Defender for Storage + *System Settings → Malware scanning*.
- Review **Admin → System → Access Review** regularly; archive audit logs with `pnpm audit:export` (or *Audit Logs → Export*).
- See [docs/06-security.md](docs/06-security.md) for the risk register and remaining backlog.

## Integrations setup (real tenants)
All integrations are optional and production-shaped; in this repository they are verified end-to-end against **local mock servers only** — follow these steps in your Microsoft 365 tenant(s).

**Secrets at rest** — set `INTEGRATIONS_KEY` (`openssl rand -base64 32`). Teams webhook URLs and the asset API key are stored AES-256-GCM encrypted; if the key changes, re-enter them.

**Microsoft Graph directory sync**
1. In the app registration: *API permissions → Add → Microsoft Graph → Application permissions → `User.Read.All`*.
2. In each synced tenant an admin grants consent: `https://login.microsoftonline.com/<tenant-id>/adminconsent?client_id=<client-id>`.
3. Uses `AUTH_MICROSOFT_ENTRA_ID_ID/_SECRET` (or `GRAPH_CLIENT_ID/_SECRET`). In **Integrations** enable sync per tenant, set the interval, *Sync now*.
4. Departments are matched by name or code within the tenant's company (create them first under Organization); unmatched names are listed after each run.

**Microsoft Teams channel cards**
1. In the target channel: *Workflows → "Post to a channel when a webhook request is received"* (or a classic Incoming Webhook) and copy the URL.
2. **Integrations → Microsoft Teams** → paste it for the support team → *Send test card*. Choose which events post cards.
3. Hosts accepted: `*.webhook.office.com`, `*.logic.azure.com`, `*.powerplatform.com`, `*.environment.api.powerplatform.com`.

**IT asset management** — *Demo data* works out of the box. For Snipe-IT (or a compatible REST API): add its host to `INTEGRATIONS_ALLOWED_HOSTS`, choose *REST API*, enter base URL + API token, adjust the field mapping if needed, then *Test lookup*.

**Power BI**
1. **Integrations → Power BI** → *Create token* (copy it — shown once). Tokens are pseudonymous unless *Include names & subjects* is ticked.
2. Power BI Desktop → *Get data → Blank query → Advanced editor*:
```
let
  Base  = "https://<your-host>/api/bi/v1/",
  Token = "sdbi_…",
  Page  = (feed as text, skip as number) =>
    Json.Document(Web.Contents(Base, [RelativePath = feed,
      Query = [#"$top" = "5000", #"$skip" = Text.From(skip)],
      Headers = [Authorization = "Bearer " & Token]])),
  Pages = List.Generate(() => [i = 0, r = Page("tickets", 0)], each List.Count([r][value]) > 0,
      each [i = [i] + 5000, r = Page("tickets", [i] + 5000)], each [r][value]),
  Tickets = Table.FromRecords(List.Combine(Pages))
in
  Tickets
```
Repeat for `tasks`, `sla-events` and the dimension feeds (`teams`, `categories`, `priorities`, `statuses`, `branches`, `departments`) and relate them by ID. For scheduled refresh in the Power BI service, store the token as the data source's header credential (or use an on-premises gateway). Use `modifiedSince=<ISO date>` for incremental refresh.

---

## Testing
```bash
pnpm typecheck
```
```bash
pnpm lint
```
```bash
pnpm lint:i18n
```
Fails when a page or component contains user-visible English text that is not in the message catalogs (JSX text and `title` / `placeholder` / `aria-label` / `label` attributes).

```bash
pnpm test:unit
```
Unit tests (pure logic, no DB): message catalogs (same keys in Thai and English, no empty texts, matching placeholders, every message formats), Thai/English fallbacks, Buddhist-era dates, notification rendering, server-message translation, untranslated-text check; scope/RBAC, workflow, routing, numbering, business-hours SLA, upload validation, Entra claims.

```bash
pnpm test:integration
```
Integration tests run the services (and local mock servers for Graph, Teams and the asset API) against a **fresh throwaway PostgreSQL database per run**: created via `TEST_DATABASE_ADMIN_URL` (default `postgresql://servicedesk:servicedesk@localhost:5432/postgres`, user needs `CREATEDB`), migrated with `prisma migrate deploy`, seeded, then dropped. Set `KEEP_TEST_DB=1` to keep it. Covered (Phase 8): notifications rendered per viewer language, Thai-only / English-only knowledge articles found and shown with fallback, Thai names in dashboards and filters, report headers in the requester's language, admin CRUD Thai labels/validation and *Name (TH)*, Thai KB draft from a ticket, Teams cards in the default language. Covered (Phase 7): Redis limiter against a real `redis-server` (shared window across instances, concurrency) and fallback, trusted-proxy IP resolution, BI bad-token throttle, access review sections/permissions/CSV, expiry notices once per window, audit export paging/escaping/self-audit/append-only, malware-scan gate with simulated Defender tags. Covered (Phase 6): impact validation, major-incident permissions/lifecycle/notifications, link cycle prevention, cascade resolution with skip reasons, banner scope, self-report; KB visibility (drafts, support-only, vendors), FTS + Thai/partial search, deflection, conversion from tickets, feedback; approval matching, manager/fallback resolution, SLA pause/resume, gate, multi-step access, rejection, policy admin; Teams outbox delivery/backoff/Retry-After/4xx, no description leakage, SSRF rejections; Graph paging, 429, create/link/update/deactivate + session revocation, managers, unmapped departments, foreign nextLink refusal; asset demo/REST mapping; Power BI auth/expiry/scope/revocation, paging, incremental, pseudonymisation. Covered (Phase 5): dashboard scope (management vs team vs other team vs vendor vs employee), every filter incl. date windows, trend granularity, aging buckets, workload/task/completion counts, SLA compliance by priority, report permission/scope, CSV formula escaping, no chat content in exports, seed grants new permission codes. Covered (Phase 4): target snapshot, pause/resume exact arithmetic, profile pause list, resolve/reopen continuation, chat first response, priority re-snapshot, sweep warnings/breaches/notifications exactly once, escalation transfer, overdue tasks once, auto-close on/off, concurrent-sweep lease, SLA target & business-hours validation/audit. Covered (Phase 3): chat participation rules, internal-note isolation (list/search/inbox/unread/attachments), vendor task-team chat, notification coalescing & disabling, unread/mark-read & read receipts, first-response and requester-reply automation, closed-ticket lock; realtime server: cookie/Origin/deactivation/revocation rejection, room authorization, signal-only payloads, internal-room isolation, `session:revoked` push. Covered (Phase 2): task numbering, supporting-team auto-add, vendor task isolation, requester read-only tasks, self-assign vs `task.assign`, reasons, reopen rules, task attachment authorization, required-task resolution gating, task list scopes, frozen tasks on closed tickets, ticket field edits + SLA recalculation, supporting-team removal guard, escalation rules. Covered (Phase 1): routing, numbering under concurrency, required fields, data scope (own/dept/confidential/vendor isolation), attachment authorization, workflow and assignment rules, append-only audit trigger, deactivation/expiry/session revocation, vendor permission stripping, privilege escalation, tenant gate.

```bash
pnpm test:e2e
```
Playwright E2E (49 tests + a warm-up step; the suite signs in with English, `i18n.spec.ts` covers Thai) against `pnpm dev` (reuses a running server on :3000) with the seeded database: create ticket → agent workflow (reason/resolution enforced) → requester closes → cross-user access denied; admin adds a subcategory; employee blocked from admin; deactivated user signed out immediately; multi-team task flow (lead creates Infrastructure task → resolve blocked → Infrastructure lead completes it from Team Tasks → resolve succeeds → requester sees progress read-only; vendor denied); two-browser realtime chat (live delivery both ways, internal note hidden from requester, image reply, live bell/Messages badges and toast, inbox, read receipts, search); SLA administration (targets, business hours, run-now, escalation rules) and SLA card pause/resume; dashboards (filters & URL state, tab switching, team drill-down, my work, report preview & CSV download, employee denied); major incident (impact → declare → banner → I'm affected too → update → cascade resolve); knowledge base (ticket → draft → publish → Help Center search, feedback, create-form suggestion & deflection, Thai search); approvals (pending gate, manager approves, agent proceeds); integrations (status page, asset test, Power BI token shown once → feed → revoke, asset check on create form, access denied for leads); security headers (nonce on every server-rendered script, fresh per request, no CSP violations); governance (access review + CSV, audit CSV/NDJSON export, denied for non-admins); languages (login page Thai by default → English, saved preference wins over the cookie in a new session, Thai category names, พ.ศ. dates, Thai notifications, Thai/English knowledge article with “read in the other language”).

---

## Project structure
```
prisma/            schema.prisma · migrations/ (incl. audit trigger) · seed.ts · seed-demo.ts
src/app/
  (auth)/login     Microsoft + developer sign-in
  (portal)/        User Portal: dashboard, tickets (my/department/branch/new/[number]), notifications, profile, search
  admin/           Admin Portal: dashboard, tickets, config/*, org/*, support/*, system/*
  api/             auth callback · attachments/[id] (scope-checked download) · reports/[type] · bi/v1/[feed] (Power BI) · health
src/server/
  auth/            Auth.js config · tenant gate · per-request actor
  authz/           permission catalog · guards · data-scope builders · errors
  domain/          workflow rules · routing · business-hours calendar (pure, unit-tested)
  services/        tickets · notifications · settings · numbering · sla · audit · analytics · reports · incidents · kb · approvals · admin/*
  integrations/    crypto · ssrf · http · outbox · teams · graph · assets · bi
  storage/         local disk · Azure Blob · upload validation
  actions/         Server Actions (thin adapters)
src/components/    ui/ (shadcn-style) · layout/ · tickets/ · admin/ · dashboard/
tests/             unit/ · integration/ · e2e/
docs/              design package
```

## Languages (Thai / English)
- **Thai is the default.** Everyone can switch **TH | EN** in the header, on the login page and on *My Profile*. The choice is saved on the user (and in the `NEXT_LOCALE` cookie for the login page), so it follows the user to other devices.
- **Dates** use the user's language and Bangkok time: Thai shows the Buddhist year (e.g. 25 พ.ย. 2569), English uses day-month-year.
- **Configuration data** (categories, statuses, priorities, support teams, departments, branches, locations, approval steps) has an optional **Name (TH)** in the Admin Portal. Empty → the English name is shown.
- **Knowledge articles** hold both languages (English and Thai title/summary/body). Readers see their language; if it is missing they see the other one, with a link to switch. Search finds either language.
- **Notifications** are stored with a message key and shown in the reader's language (also after switching). **Microsoft Teams channel cards** use *System Settings › Language of Microsoft Teams channel cards* (default Thai). **CSV exports** (reports, access review) use the language of the person exporting; the audit export stays English (archive format).
- **Changing wording:** all texts are in `messages/th.json` and `messages/en.json` (same keys in both). Edit the text, keep `{placeholders}` unchanged, then run `pnpm typecheck && pnpm test:unit`. Server messages (errors, CSV headers, Teams cards) are in the `srv` / `srvTpl` sections, keyed by their English text.

## Configuration managed in the Admin Portal (no code changes)
Thai names of configuration data, Teams card language, approval policies & steps (with Thai step names), knowledge articles (Thai + English), Teams webhooks/events, Graph sync per tenant, asset provider, Power BI tokens, categories/subcategories (default team, priority, SLA, required fields, active), auto-assignment rules, priorities, statuses (kind, colour, reason, SLA pause), workflow transitions (permission, requester-allowed, comment), holidays, companies/departments/branches/locations, support teams & members (internal/vendor/outsource), users (roles, org mapping, ticket visibility, status, access expiry), roles & permissions, Microsoft tenants, ticket/task number format, upload limits & file types, reopen window, fallback team, default priority.
