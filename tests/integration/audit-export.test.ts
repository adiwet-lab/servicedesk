import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { exportRange, startAuditExport } from "@/server/services/admin/audit-export";
import { audit } from "@/server/services/audit";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";

async function actor(email: string) {
  return (await loadActor(prisma, (await prisma.user.findFirstOrThrow({ where: { email } })).id))!;
}
async function collect(g: AsyncGenerator<string>) { let s = ""; for await (const c of g) s += c; return s; }
afterAll(() => prisma.$disconnect());

describe("audit export", () => {
  it("requires audit.read (never vendors) and validates the range", async () => {
    await expect(startAuditExport(await actor("lee.lead@contoso.example"), {}, "csv")).rejects.toBeInstanceOf(AuthorizationError);
    await expect(startAuditExport(await actor("victor@vendor-a.example"), {}, "csv")).rejects.toBeInstanceOf(AuthorizationError);
    expect(() => exportRange({ from: "2026-02-01", to: "2026-01-01" })).toThrow(ValidationError);
    expect(() => exportRange({ from: "2024-01-01", to: "2026-01-01" })).toThrow(/366/);
    expect(exportRange({}, new Date("2026-11-19T10:00:00Z"))).toMatchObject({ from: "2026-10-21", to: "2026-11-19" });
  });

  it("streams every row in order across pages, escapes CSV formulas, and audits itself first", async () => {
    const admin = await actor("sys.admin@contoso.example");
    const marker = `EXP${Date.now()}`;
    for (let i = 0; i < 2105; i++) await prisma.auditLog.create({ data: { action: marker, entityType: "Test", entityId: i === 0 ? "=cmd|' /C calc'!A0" : String(i), newValue: { i } } });
    await audit(prisma, admin, { action: marker, entityType: "Test", entityId: "with-actor" });
    const before = await prisma.auditLog.count({ where: { action: "AUDIT_EXPORTED" } });

    const nd = await startAuditExport(admin, { action: marker }, "ndjson");
    expect(nd.total).toBe(2106);
    expect(await prisma.auditLog.count({ where: { action: "AUDIT_EXPORTED" } })).toBe(before + 1);
    const lines = (await collect(nd.chunks)).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2106);
    expect(new Set(lines.map((l) => l.id)).size).toBe(2106); // no duplicates across keyset pages
    expect(lines.map((l) => l.createdAt)).toEqual([...lines.map((l) => l.createdAt)].sort());
    expect(lines.at(-1)).toMatchObject({ entityId: "with-actor", actorEmail: "sys.admin@contoso.example" });

    const csv = await collect((await startAuditExport(admin, { action: marker }, "csv")).chunks);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const rows = csv.slice(1).trimEnd().split("\r\n");
    expect(rows[0]).toBe("id,createdAt,action,entityType,entityId,actorId,actorEmail,ticketId,ticketNumber,ipAddress,userAgent,oldValue,newValue");
    expect(rows).toHaveLength(2107);
    expect(csv).toContain(`'=cmd|`);
    expect(csv).toContain(`"{""i"":0}"`);
  });

  it("archive mode (no actor) is audited as a system export; the log stays append-only", async () => {
    const r = await startAuditExport(null, {}, "ndjson");
    await collect(r.chunks);
    expect(await prisma.auditLog.count({ where: { action: "AUDIT_ARCHIVE_EXPORTED", actorId: null } })).toBeGreaterThan(0);
    await expect(prisma.$executeRaw`DELETE FROM "AuditLog" WHERE "action" = 'AUDIT_ARCHIVE_EXPORTED'`).rejects.toThrow();
  });
});
