# 03 · Authentication & Multi-Tenant Architecture

## App registration
One **multi-tenant** Microsoft Entra app registration ("Accounts in any organizational directory").
- Redirect URI (Web): `{APP_URL}/api/auth/callback/microsoft-entra-id`
- Scopes: `openid profile email` (Graph scopes added in Phase 6)
- Each external organization's admin grants tenant-wide consent once (admin-consent URL: `https://login.microsoftonline.com/{tenant}/adminconsent?client_id={clientId}`).

## Sign-in flow
```
User ─▶ /login ─▶ Auth.js ─▶ login.microsoftonline.com/organizations/v2.0 (Authorization Code + PKCE, nonce, state)
     ◀─ code ◀─────────────────────────────┘
Auth.js: exchange code; re-discover metadata for the token's `tid`; validate ID token signature,
         audience, nonce and the TENANT-SPECIFIC issuer https://login.microsoftonline.com/{tid}/v2.0
signIn callback ─▶ resolveEntraUser():
   1. validate tid/oid are GUIDs and iss == https://login.microsoftonline.com/{tid}/v2.0 (defence in depth)
   2. Tenant allow-list: Tenant(entraTenantId = tid) must exist and be active   → else "tenant_not_allowed"/"tenant_inactive"
   3. User by (tenant, oid) → found
      else pre-created user in SAME tenant with null oid and matching email → link oid
      else auto-provision (tenant.autoProvisionUsers) with tenant.defaultRole, or create as PENDING
   4. status must be ACTIVE, accessExpiresAt not passed                           → else pending/inactive/expired
jwt callback ─▶ cookie stores only { uid, sv (sessionVersion) }  (httpOnly, Secure on https, SameSite=Lax, 8h)
```

## Per-request session validation
`getActor()` (React `cache` per request) decodes the cookie and **reloads the user from PostgreSQL**:
- user exists, not soft-deleted, `status = ACTIVE`
- `tenant.isActive`
- `accessExpiresAt` in the future (outsource expiry)
- `sessionVersion` equals the cookie's `sv` — admins bump it on deactivation / role / visibility change or "Sign out everywhere"
- permissions = union of role permissions **minus** `VENDOR_FORBIDDEN_PERMISSIONS` for vendor tenants
- team memberships (active teams only)

Any failure → treated as signed out (`/login?error=session_revoked`). This makes deactivation, tenant disablement and permission changes effective on the **next request**, not at token expiry.

## Why not email domains
Users may have multiple UPNs/aliases, domains can be shared or re-assigned, and B2B guests carry foreign domains. Authorization therefore uses only `tid` (verified by issuer + signature) and `oid`. Email is display data and is used for *linking* only inside an already-verified tenant.

## Internal vs external users
| | Internal tenant | Vendor tenant |
|---|---|---|
| Auto-provision | typically on (Employee role) | typically off (PENDING until approved) |
| Visibility | own / dept / branch per user setting + team scope | team-owned / assigned only |
| Internal notes | per role | never (stripped at runtime) |
| Admin permissions | per role | never (stripped at runtime) |
| Access expiry | optional | recommended (`accessExpiresAt`) |
| Team membership | internal teams | only VENDOR/OUTSOURCE teams of the same tenant |

## Developer login
`AUTH_DEV_LOGIN=true` adds a credentials provider listing seeded users. It is compiled out at runtime when `NODE_ENV=production` (verified: the standalone production server hides it even with the flag set).
