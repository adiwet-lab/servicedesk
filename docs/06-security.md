# 06 · Security Design & Risk Register

| # | Risk | Mitigation (implemented in Phase 1) | Where |
|---|---|---|---|
| 1 | Users from unauthorized Microsoft tenants sign in (multi-tenant app) | Tenant allow-list by `tid`; tenant-specific issuer validated by Auth.js **and** re-checked; inactive tenant blocks sign-in and live sessions | `server/auth/tenant-gate.ts`, `load-actor.ts` |
| 2 | Identity spoofing via email/UPN | Identity = (tenant, `oid`); email only used to link pre-created users **within the verified tenant** | `tenant-gate.ts` (tested) |
| 3 | Stale access after deactivation / role change / outsource expiry | Actor reloaded per request; `status`, `accessExpiresAt`, tenant state, `sessionVersion` checked; admin "Sign out everywhere" | `load-actor.ts`, `admin/users.ts` (E2E-tested) |
| 4 | IDOR / horizontal privilege escalation on tickets | Every read `AND ticketScopeWhere(actor)`; mutations re-load via scope; 404 (not 403) for out-of-scope objects | `authz/scope.ts`, `services/tickets.ts` |
| 5 | Confidential ticket leakage | Confidential filter in scope (requester, assignee, owner team only) | `authz/scope.ts` |
| 6 | Internal note leakage to requesters/vendors | `messageScopeWhere` filters in query; vendor tenants can never hold `note.internal.*` | `authz/scope.ts`, `permissions.ts` |
| 7 | Vendor over-privilege through mis-configured roles | `VENDOR_FORBIDDEN_PERMISSIONS` stripped at runtime; vendor users only join own-tenant vendor teams; admin roles refused for vendor users | `load-actor.ts`, `admin/users.ts` |
| 8 | Vertical privilege escalation by admins | Admins can only grant roles/permissions they hold; cannot de-role/deactivate themselves; Super Admin keeps `admin.roles` | `admin/users.ts` (tested) |
| 9 | CSRF | Server Actions: POST-only + Origin/Host check by Next.js (`allowedOrigins` = APP_URL); Auth.js double-submit CSRF token; SameSite=Lax cookies; no state-changing GETs | `next.config.ts` |
| 10 | XSS | React auto-escaping; no `dangerouslySetInnerHTML`; admin colours validated as hex; CSP (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`); attachments served with `Content-Disposition: attachment`, `nosniff`, sandbox CSP | `next.config.ts`, `api/attachments` |
| 11 | SQL injection | Prisma parameterised queries; the only raw SQL uses tagged templates with bound parameters (sequence) or server-generated identifiers (test harness) | `services/numbering.ts` |
| 12 | Malicious uploads | Extension allow-list (admin-configurable) + magic-byte sniffing + HTML/script rejection for text + size/count limits + sanitised names + random storage keys + private storage + auth-checked download | `storage/validate.ts` (tested) |
| 13 | Path traversal in storage | Keys server-generated; local driver resolves inside root only | `storage/local.ts` |
| 14 | Brute force / abuse | Rate limits on ticket creation and uploads (memory, Redis-ready interface); Entra handles credential attacks (no passwords in app) | `ratelimit.ts` |
| 15 | Audit tampering | `AuditLog` append-only via PostgreSQL triggers (UPDATE/DELETE/TRUNCATE raise); no edit UI; IP + user-agent captured | migration, `services/audit.ts` (tested) |
| 16 | Secret leakage | Secrets only via env (Key Vault references in Azure); `.env*` git-ignored; provider tokens not stored in session cookie | `.env.example` |
| 17 | Session theft | httpOnly, Secure (https), SameSite=Lax, 8h max age, server-side revocation via `sessionVersion` | `auth.ts` |
| 18 | Transport | HTTPS-ready: HSTS when `APP_URL` is https; TLS terminates at Front Door/App Gateway | `next.config.ts` |
| 19 | Clickjacking / MIME sniffing | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, strict Referrer-Policy | `next.config.ts` |
| 20 | Race conditions | Atomic numbering; conditional status updates; unique constraints | services |
| 22 | Cross-site WebSocket hijacking | Socket.IO accepts only allow-listed Origins (APP_URL); session cookie is SameSite=Lax | `realtime/socket-server.ts` (tested) |
| 23 | Realtime data leakage / stale room membership | Events carry signals only; data re-fetched via authorized actions; room joins re-check scope and actor status; internal room limited to internal note readers; periodic re-validation and `session:revoked` push | `realtime/*` (tested) |
| 24 | Internal note leakage via search/inbox/counters/files | `messageScopeWhere` applied in list, search, inbox preview and unread SQL; message attachments of internal notes refused to non-readers | `services/messages.ts` (tested) |
| 25 | Chat spam / abuse | 30 messages/min/user rate limit; 10k character limit; upload validation as for tickets | `services/messages.ts` |
| 21 | Dev backdoor in production | Dev login disabled when `NODE_ENV=production` regardless of flag (verified on the standalone build) | `auth.ts` |

## Hardening backlog
- Nonce-based CSP (remove `'unsafe-inline'` for scripts) via middleware.
- Redis-backed rate limiter + per-IP limits at Front Door WAF.
- Antivirus scanning of uploads (Microsoft Defender for Storage) before download is allowed.
- Managed identity for Blob/PostgreSQL instead of connection strings.
- Periodic access review report for vendor accounts nearing expiry.
- Audit log export/retention to Log Analytics (immutable storage).
