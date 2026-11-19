import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { exportAccessReviewCsv, getAccessReview, runExpiryNotices } from "@/server/services/admin/access-review";
import { AuthorizationError } from "@/server/authz/errors";

const DAY = 86_400_000;
async function actor(email: string) {
  const u = await prisma.user.findFirstOrThrow({ where: { email } });
  return (await loadActor(prisma, u.id))!;
}
const ADMIN = "sys.admin@contoso.example";
afterAll(() => prisma.$disconnect());

describe("access review", () => {
  it("lists expiring, expired, inactive and privileged accounts; reviewers only", async () => {
    const vendorTenant = await prisma.tenant.findFirstOrThrow({ where: { type: "VENDOR" } });
    const now = new Date();
    const soon = await prisma.user.create({ data: { tenantId: vendorTenant.id, email: `soon-${Date.now()}@vendor.test`, displayName: "Soon Expiring", accessExpiresAt: new Date(now.getTime() + 5 * DAY), lastLoginAt: now } });
    const past = await prisma.user.create({ data: { tenantId: vendorTenant.id, email: `past-${Date.now()}@vendor.test`, displayName: "Already Expired", accessExpiresAt: new Date(now.getTime() - DAY), lastLoginAt: now } });
    const idle = await prisma.user.create({ data: { tenantId: vendorTenant.id, email: `idle-${Date.now()}@vendor.test`, displayName: "Idle User", lastLoginAt: new Date(now.getTime() - 200 * DAY) } });

    const r = await getAccessReview(await actor(ADMIN));
    expect(r.expiring.map((u) => u.id)).toContain(soon.id);
    expect(r.expiring.map((u) => u.id)).not.toContain(past.id);
    expect(r.expired.map((u) => u.id)).toContain(past.id);
    expect(r.inactive.map((u) => u.id)).toContain(idle.id);
    const superAdmin = r.privileged.find((u) => u.email === "super.admin@contoso.example")!;
    expect(superAdmin.privileges).toEqual(expect.arrayContaining(["admin.roles", "admin.tenants"]));
    expect(r.privileged.some((u) => u.email === "emma@contoso.example")).toBe(false);

    await expect(getAccessReview(await actor("lee.lead@contoso.example"))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(getAccessReview(await actor("victor@vendor-a.example"))).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("CSV export is formula-safe and audited", async () => {
    const t = await prisma.tenant.findFirstOrThrow({ where: { type: "VENDOR" } });
    await prisma.user.create({ data: { tenantId: t.id, email: `evil-${Date.now()}@vendor.test`, displayName: "=HYPERLINK(\"http://x\")", accessExpiresAt: new Date(Date.now() + 3 * DAY) } });
    const before = await prisma.auditLog.count({ where: { action: "ACCESS_REVIEW_EXPORTED" } });
    const csv = await exportAccessReviewCsv(await actor(ADMIN));
    expect(csv.split("\n")[0]).toContain("Section");
    expect(csv).toContain("'=HYPERLINK");
    expect(await prisma.auditLog.count({ where: { action: "ACCESS_REVIEW_EXPORTED" } })).toBe(before + 1);
  });
});

describe("expiry notices", () => {
  it("notifies the user and user admins once per expiry window; re-notifies after an extension", async () => {
    const t = await prisma.tenant.findFirstOrThrow({ where: { type: "VENDOR" } });
    const now = new Date();
    const u = await prisma.user.create({ data: { tenantId: t.id, email: `notice-${Date.now()}@vendor.test`, displayName: "Notice Target", accessExpiresAt: new Date(now.getTime() + 10 * DAY) } });
    const admin = await actor(ADMIN);
    const count = (userId: string) => prisma.notification.count({ where: { userId, type: "ACCESS_EXPIRING", title: { contains: userId === u.id ? "Your access" : "Notice Target" } } });

    await runExpiryNotices(prisma, now);
    expect(await count(u.id)).toBe(1);
    expect(await count(admin.id)).toBe(1);
    await runExpiryNotices(prisma, new Date(now.getTime() + DAY));
    expect(await count(u.id)).toBe(1); // once per window

    // Extended by 60 days → silent now, notified again when the new date approaches.
    await prisma.user.update({ where: { id: u.id }, data: { accessExpiresAt: new Date(now.getTime() + 70 * DAY) } });
    await runExpiryNotices(prisma, new Date(now.getTime() + 2 * DAY));
    expect(await count(u.id)).toBe(1);
    await runExpiryNotices(prisma, new Date(now.getTime() + 60 * DAY));
    expect(await count(u.id)).toBe(2);
    // Vendor users never receive the admin notice.
    const vendorUser = await prisma.user.findFirstOrThrow({ where: { email: "victor@vendor-a.example" } });
    expect(await prisma.notification.count({ where: { userId: vendorUser.id, type: "ACCESS_EXPIRING", title: { contains: "Notice Target" } } })).toBe(0);
  });
});
