import type { Prisma, PrismaClient } from "@prisma/client";
import { translateServerText } from "@/i18n/server-text-translate";
import type { Locale } from "@/i18n/config";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { can } from "@/server/authz/guards";
import { AuthorizationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { toCsv } from "@/server/domain/analytics";
import { acquireLease, releaseLease } from "@/server/jobs/lease";
import { audit } from "@/server/services/audit";
import { notifyUsers } from "@/server/services/notifications";
import { transaction } from "@/server/db-tx";

/** Permissions whose holders are listed as privileged in the access review. */
export const PRIVILEGED_PERMISSIONS = [P.ADMIN_ROLES, P.ADMIN_TENANTS, P.ADMIN_USERS, P.INTEGRATIONS_MANAGE, P.TICKET_READ_ALL, P.AUDIT_READ] as const;
export const EXPIRY_NOTICE_DAYS = 14;
const DAY = 86_400_000;

function requireReviewer(actor: Actor) {
  if (isVendor(actor) || !can(actor, P.ADMIN_USERS)) throw new AuthorizationError("You cannot run access reviews.");
}

const userSelect = {
  id: true, displayName: true, email: true, status: true, accessExpiresAt: true, lastLoginAt: true, createdAt: true,
  tenant: { select: { name: true, type: true } },
  roles: { select: { role: { select: { code: true, name: true, permissions: { select: { permission: { select: { code: true } } } } } } } },
} satisfies Prisma.UserSelect;
type Row = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const shape = (u: Row) => ({
  id: u.id, name: u.displayName, email: u.email, status: u.status, tenant: u.tenant.name, tenantType: u.tenant.type,
  roles: u.roles.map((r) => r.role.name), accessExpiresAt: u.accessExpiresAt, lastLoginAt: u.lastLoginAt,
  privileges: [...new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)))].filter((c) => (PRIVILEGED_PERMISSIONS as readonly string[]).includes(c)),
});

export async function getAccessReview(actor: Actor, opts: { expiringDays?: number; inactiveDays?: number; now?: Date } = {}) {
  requireReviewer(actor);
  const now = opts.now ?? new Date();
  const expiringDays = opts.expiringDays ?? EXPIRY_NOTICE_DAYS;
  const inactiveDays = opts.inactiveDays ?? 90;
  const active: Prisma.UserWhereInput = { status: "ACTIVE", deletedAt: null };
  const inactiveSince = new Date(now.getTime() - inactiveDays * DAY);
  const [expiring, expired, inactive, privileged, tokens] = await Promise.all([
    prisma.user.findMany({ where: { ...active, accessExpiresAt: { gt: now, lte: new Date(now.getTime() + expiringDays * DAY) } }, orderBy: { accessExpiresAt: "asc" }, select: userSelect }),
    prisma.user.findMany({ where: { ...active, accessExpiresAt: { lte: now } }, orderBy: { accessExpiresAt: "asc" }, select: userSelect }),
    prisma.user.findMany({
      where: { ...active, OR: [{ lastLoginAt: { lt: inactiveSince } }, { lastLoginAt: null, createdAt: { lt: inactiveSince } }] },
      orderBy: [{ lastLoginAt: { sort: "asc", nulls: "first" } }], take: 500, select: userSelect,
    }),
    prisma.user.findMany({
      where: { ...active, roles: { some: { role: { permissions: { some: { permission: { code: { in: [...PRIVILEGED_PERMISSIONS] } } } } } } } },
      orderBy: { displayName: "asc" }, select: userSelect,
    }),
    prisma.apiToken.findMany({ where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: { createdAt: "asc" },
      select: { id: true, name: true, prefix: true, includeNames: true, expiresAt: true, lastUsedAt: true, createdBy: { select: { displayName: true } } } }),
  ]);
  return {
    expiringDays, inactiveDays, generatedAt: now,
    expiring: expiring.map(shape), expired: expired.map(shape), inactive: inactive.map(shape), privileged: privileged.map(shape), tokens,
  };
}

export async function exportAccessReviewCsv(actor: Actor, locale: Locale = "en") {
  const r = await getAccessReview(actor);
  const tr = (x: string) => translateServerText(x, locale);
  const d = (x: Date | null) => (x ? x.toISOString() : "");
  const rows: unknown[][] = [];
  for (const [section, list] of [["Expiring", r.expiring], ["Expired but active", r.expired], ["Inactive", r.inactive], ["Privileged", r.privileged]] as const) {
    for (const u of list) rows.push([tr(section), u.name, u.email, u.tenant, u.tenantType, u.roles.join("; "), u.privileges.join("; "), d(u.lastLoginAt), d(u.accessExpiresAt)]);
  }
  for (const t of r.tokens) rows.push([tr("API token"), t.name, `${t.prefix}…`, "", "", "bi.read", tr(t.includeNames ? "includes names" : "pseudonymous"), d(t.lastUsedAt), d(t.expiresAt)]);
  await audit(prisma, actor, { action: "ACCESS_REVIEW_EXPORTED", entityType: "AccessReview", entityId: "access-review", newValue: { rows: rows.length } });
  return toCsv(["Section", "Name", "Email / token", "Tenant", "Tenant type", "Roles", "Privileges", "Last login / used", "Access expires"].map(tr), rows);
}

// ───────────────────────────── Expiry notices (job) ─────────────────────────────

/**
 * Notifies the user and every internal holder of admin.users once per expiry window
 * (re-notifies if the expiry date was extended and approaches again).
 */
export async function runExpiryNotices(db: PrismaClient = prisma, now = new Date()) {
  const holder = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  if (!(await acquireLease(db, "jobs.accessExpiry.lease", holder, 5 * 60_000))) return { skipped: true, notified: 0 };
  try {
    const horizon = new Date(now.getTime() + EXPIRY_NOTICE_DAYS * DAY);
    const due = await db.user.findMany({
      where: { status: "ACTIVE", deletedAt: null, accessExpiresAt: { gt: now, lte: horizon } },
      select: { id: true, displayName: true, accessExpiresAt: true, expiryNotifiedAt: true, tenant: { select: { name: true } } },
    });
    const pending = due.filter((u) => !u.expiryNotifiedAt || u.expiryNotifiedAt.getTime() < u.accessExpiresAt!.getTime() - EXPIRY_NOTICE_DAYS * DAY);
    if (!pending.length) return { notified: 0 };
    const admins = (await db.user.findMany({
      where: { status: "ACTIVE", deletedAt: null, tenant: { type: { not: "VENDOR" } }, roles: { some: { role: { permissions: { some: { permission: { code: P.ADMIN_USERS } } } } } } },
      select: { id: true },
    })).map((a) => a.id);
    let notified = 0;
    for (const u of pending) {
      await transaction(async (tx) => {
        // Claim first so concurrent runs can't double-notify.
        const claimed = await tx.user.updateMany({ where: { id: u.id, expiryNotifiedAt: u.expiryNotifiedAt }, data: { expiryNotifiedAt: now } });
        if (claimed.count !== 1) return;
        const when = u.accessExpiresAt!.toISOString().slice(0, 10);
        await notifyUsers(tx, admins.filter((id) => id !== u.id), { type: "ACCESS_EXPIRING", key: "accessExpiringAdmin", params: { date: when, name: u.displayName, tenant: u.tenant.name }, title: `Access expires ${when}: ${u.displayName}`, body: `${u.tenant.name} — extend or let it lapse.`, link: `/admin/system/users/${u.id}` });
        await notifyUsers(tx, [u.id], { type: "ACCESS_EXPIRING", key: "accessExpiringSelf", params: { date: when }, title: `Your access expires on ${when}`, body: "Contact your IT administrator if you still need access." });
        await audit(tx, null, { action: "ACCESS_EXPIRY_NOTICE", entityType: "User", entityId: u.id, newValue: { accessExpiresAt: u.accessExpiresAt } });
        notified++;
      });
    }
    return { notified };
  } finally {
    await releaseLease(db, "jobs.accessExpiry.lease", holder).catch(() => {});
  }
}
