import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { resolveEntraUser } from "@/server/auth/tenant-gate";
import { assignTicket, changeTicketStatus, createTicket, getTicketDetail, listTickets, readAttachment } from "@/server/services/tickets";
import { saveCrud } from "@/server/services/admin/crud";
import { updateUser } from "@/server/services/admin/users";
import { ticketListQuerySchema } from "@/lib/validation/ticket";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";

const email = {
  emma: "emma@contoso.example", ethan: "ethan@contoso.example", somchai: "somchai@contoso.example", fiona: "fiona@fabrikam.example",
  agent: "ana.agent@contoso.example", lead: "lee.lead@contoso.example", admin: "sys.admin@contoso.example", superadmin: "super.admin@contoso.example",
  vendorA: "victor@vendor-a.example", vendorB: "vera@vendor-b.example",
};
async function actor(k: keyof typeof email) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: email[k] } });
  const a = await loadActor(prisma, u.id);
  if (!a) throw new Error(`${k} not active`);
  return a;
}
const cat = async (code: string) => (await prisma.category.findUniqueOrThrow({ where: { code } })).id;
const status = async (code: string) => (await prisma.ticketStatus.findUniqueOrThrow({ where: { code } })).id;
const year = new Date().getFullYear();

let printerTicket: { id: string; number: string };

beforeAll(async () => {
  const emma = await actor("emma");
  printerTicket = await createTicket(emma, {
    subject: "Printer jams on every print job", description: "Finance printer jams on every job since Monday.",
    categoryId: await cat("HW"), subcategoryId: await cat("HW-PR"), relatedAsset: "PRN-01",
  }, [{ name: "error.log", size: 9, data: Buffer.from("E: jam 42") }]);
});
afterAll(() => prisma.$disconnect());

describe("ticket creation", () => {
  it("generates the configured number and routes via category defaults", async () => {
    expect(printerTicket.number).toMatch(new RegExp(`^IT-${year}-\\d{6}$`));
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: printerTicket.id }, include: { ownerTeam: true, status: true, assignments: true, history: true, attachments: true } });
    expect(t.ownerTeam?.code).toBe("IT-SUPPORT");
    expect(t.status.code).toBe("NEW");
    expect(t.assignments[0]?.type).toBe("AUTO");
    expect(t.history[0]?.action).toBe("CREATED");
    expect(t.attachments).toHaveLength(1);
    expect(t.resolutionDueAt).not.toBeNull();
    expect(t.departmentId).not.toBeNull();
  });
  it("writes an audit record and notifies the owning team", async () => {
    expect(await prisma.auditLog.count({ where: { ticketId: printerTicket.id, action: "TICKET_CREATED" } })).toBe(1);
    const agent = await actor("agent");
    expect(await prisma.notification.count({ where: { userId: agent.id, ticketId: printerTicket.id, type: "TICKET_CREATED" } })).toBe(1);
  });
  it("routes subcategory overrides to vendor teams", async () => {
    const t = await createTicket(await actor("somchai"), {
      subject: "Internet down at the store", description: "No internet since 8am at Siam store.",
      categoryId: await cat("NW"), subcategoryId: await cat("NW-INET"),
    });
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id }, include: { ownerTeam: true } });
    expect(row.ownerTeam?.code).toBe("VENDOR-A");
  });
  it("enforces category-configured required fields", async () => {
    await expect(createTicket(await actor("somchai"), {
      subject: "POS frozen at till 2", description: "POS freezes after scanning items.", categoryId: await cat("RTL"), subcategoryId: await cat("RTL-POS"),
    })).rejects.toMatchObject({ fieldErrors: { relatedAsset: expect.any(String) } });
  });
  it("requires a subcategory when the category has children", async () => {
    await expect(createTicket(await actor("emma"), { subject: "Something broke", description: "Something is broken here.", categoryId: await cat("HW") }))
      .rejects.toBeInstanceOf(ValidationError);
  });
  it("rejects spoofed attachments", async () => {
    await expect(createTicket(await actor("emma"), {
      subject: "Monitor broken", description: "My monitor shows nothing.", categoryId: await cat("HW"), subcategoryId: await cat("HW-MN"), relatedAsset: "M1",
    }, [{ name: "invoice.pdf", size: 10, data: Buffer.from("MZ-not-pdf") }])).rejects.toBeInstanceOf(ValidationError);
  });
  it("allocates unique numbers under concurrency", async () => {
    const emma = await actor("emma");
    const base = { description: "Concurrency test ticket body.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-SW") };
    const res = await Promise.all([1, 2, 3, 4, 5].map((i) => createTicket(emma, { ...base, subject: `Install tool #${i}` })));
    expect(new Set(res.map((r) => r.number)).size).toBe(5);
  });
});

describe("data-scope authorization", () => {
  it("another employee (own-only visibility) cannot read the ticket", async () => {
    await expect(getTicketDetail(await actor("fiona"), printerTicket.number)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("a department-scope colleague can read it", async () => {
    const d = await getTicketDetail(await actor("ethan"), printerTicket.number);
    expect(d.ticket.id).toBe(printerTicket.id);
    expect(d.permissions.canWork).toBe(false);
  });
  it("confidential tickets are hidden from department colleagues", async () => {
    const t = await createTicket(await actor("emma"), {
      subject: "Salary file access issue", description: "Cannot open the payroll spreadsheet.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-ACC"), isConfidential: "on",
    });
    await expect(getTicketDetail(await actor("ethan"), t.number)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getTicketDetail(await actor("agent"), t.number)).ticket.isConfidential).toBe(true);
  });
  it("vendor A cannot see internal-team tickets but sees its own team's", async () => {
    const v = await actor("vendorA");
    await expect(getTicketDetail(v, printerTicket.number)).rejects.toBeInstanceOf(NotFoundError);
    const list = await listTickets(v, "all", ticketListQuerySchema.parse({}));
    expect(list.rows.every((r) => r.ownerTeam?.code === "VENDOR-A")).toBe(true);
    expect(list.total).toBeGreaterThan(0);
  });
  it("vendor B cannot see vendor A tickets", async () => {
    const list = await listTickets(await actor("vendorB"), "all", ticketListQuerySchema.parse({}));
    expect(list.rows.some((r) => r.ownerTeam?.code === "VENDOR-A")).toBe(false);
  });
  it("attachment download is scope-checked", async () => {
    const att = await prisma.ticketAttachment.findFirstOrThrow({ where: { ticketId: printerTicket.id } });
    await expect(readAttachment(await actor("fiona"), att.id)).rejects.toBeInstanceOf(NotFoundError);
    const ok = await readAttachment(await actor("emma"), att.id);
    expect(ok.data.toString()).toBe("E: jam 42");
  });
  it("employees cannot open support list views", async () => {
    await expect(listTickets(await actor("emma"), "all", ticketListQuerySchema.parse({}))).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("workflow & assignment", () => {
  it("requester cannot perform staff-only transitions", async () => {
    await expect(changeTicketStatus(await actor("emma"), { ticketId: printerTicket.id, toStatusId: await status("IN_PROGRESS") })).rejects.toBeInstanceOf(AuthorizationError);
  });
  it("agent cannot transfer to another team; lead can with a reason", async () => {
    const infra = await prisma.supportTeam.findUniqueOrThrow({ where: { code: "INFRA" } });
    const agent = await actor("agent");
    await expect(assignTicket(agent, { ticketId: printerTicket.id, teamId: infra.id, reason: "x" })).rejects.toBeInstanceOf(AuthorizationError);
    const lead = await actor("lead");
    await expect(assignTicket(lead, { ticketId: printerTicket.id, teamId: infra.id })).rejects.toThrow(/reason is required/);
  });
  it("assigning an agent auto-advances NEW → Assigned and records history", async () => {
    const lead = await actor("lead");
    const agent = await actor("agent");
    await assignTicket(lead, { ticketId: printerTicket.id, agentId: agent.id, reason: "Printer specialist" });
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: printerTicket.id }, include: { status: true, assignments: { orderBy: { createdAt: "desc" } } } });
    expect(t.assignedAgentId).toBe(agent.id);
    expect(t.status.code).toBe("ASSIGNED");
    expect(t.assignments[0]).toMatchObject({ type: "ASSIGN", newAgentId: agent.id, changedById: lead.id, reason: "Printer specialist" });
  });
  it("agent cannot assign to a non-member", async () => {
    const lead = await actor("lead");
    const fiona = await actor("fiona");
    await expect(assignTicket(lead, { ticketId: printerTicket.id, agentId: fiona.id })).rejects.toThrow(/not an active member/);
  });
  it("waiting requires a reason; resolve requires a summary", async () => {
    const agent = await actor("agent");
    await changeTicketStatus(agent, { ticketId: printerTicket.id, toStatusId: await status("IN_PROGRESS") });
    await expect(changeTicketStatus(agent, { ticketId: printerTicket.id, toStatusId: await status("WAITING_USER") })).rejects.toThrow(/reason is required/);
    await changeTicketStatus(agent, { ticketId: printerTicket.id, toStatusId: await status("WAITING_USER"), reason: "Which tray?" });
    let t = await prisma.ticket.findUniqueOrThrow({ where: { id: printerTicket.id } });
    expect(t.waitingReason).toBe("Which tray?");
    expect(t.slaPausedAt).not.toBeNull();
    await expect(changeTicketStatus(agent, { ticketId: printerTicket.id, toStatusId: await status("RESOLVED") })).rejects.toThrow(/resolution summary/);
    await changeTicketStatus(agent, { ticketId: printerTicket.id, toStatusId: await status("RESOLVED"), resolutionSummary: "Replaced roller" });
    t = await prisma.ticket.findUniqueOrThrow({ where: { id: printerTicket.id } });
    expect(t.resolvedAt).not.toBeNull();
    // Resolution stops the SLA clock (kept stopped so a reopen continues it) and records the outcome.
    expect(t.slaPausedAt).not.toBeNull();
    expect(await prisma.slaEvent.count({ where: { ticketId: printerTicket.id, clock: "RESOLUTION", type: { in: ["MET", "BREACHED"] } } })).toBe(1);
  });
  it("requester can close, after which the ticket is locked for the agent", async () => {
    await changeTicketStatus(await actor("emma"), { ticketId: printerTicket.id, toStatusId: await status("CLOSED") });
    await expect(changeTicketStatus(await actor("agent"), { ticketId: printerTicket.id, toStatusId: await status("IN_PROGRESS") })).rejects.toThrow();
    // Admin with ticket.closed.edit may reopen
    await changeTicketStatus(await actor("admin"), { ticketId: printerTicket.id, toStatusId: await status("IN_PROGRESS"), reason: "Issue recurred" });
    const h = await prisma.ticketHistory.findFirst({ where: { ticketId: printerTicket.id, action: "REOPENED" } });
    expect(h?.reason).toBe("Issue recurred");
  });
});

describe("audit log is append-only", () => {
  it("UPDATE and DELETE are blocked by the database", async () => {
    const row = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "TAMPERED" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});

describe("account lifecycle & sessions", () => {
  it("deactivation revokes access immediately", async () => {
    const admin = await actor("admin");
    const somchai = await actor("somchai");
    const before = await prisma.user.findUniqueOrThrow({ where: { id: somchai.id }, include: { roles: true } });
    await updateUser(admin, somchai.id, {
      displayName: before.displayName, ticketVisibility: before.ticketVisibility, status: "INACTIVE", roleIds: before.roles.map((r) => r.roleId),
      companyId: before.companyId, departmentId: before.departmentId, branchId: before.branchId,
    });
    expect(await loadActor(prisma, somchai.id)).toBeNull();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: somchai.id } });
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(await loadActor(prisma, somchai.id, { sessionVersion: before.sessionVersion })).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: somchai.id, action: "USER_DEACTIVATED" } })).toBe(1);
    await prisma.user.update({ where: { id: somchai.id }, data: { status: "ACTIVE" } }); // restore for other suites
  });
  it("expired outsource access is rejected", async () => {
    const v = await actor("vendorB");
    expect(await loadActor(prisma, v.id, { now: new Date(Date.now() + 365 * 86400000) })).toBeNull();
  });
  it("vendor users never hold forbidden permissions even if granted an admin role", async () => {
    const v = await actor("vendorA");
    const superRole = await prisma.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" } });
    await prisma.userRole.create({ data: { userId: v.id, roleId: superRole.id } });
    const a = (await loadActor(prisma, v.id))!;
    expect(a.permissions.has("ticket.read.all")).toBe(false);
    expect(a.permissions.has("admin.users")).toBe(false);
    expect(a.permissions.has("note.internal.read")).toBe(false);
    await prisma.userRole.delete({ where: { userId_roleId: { userId: v.id, roleId: superRole.id } } });
  });
  it("a System Admin cannot escalate a user to Super Admin", async () => {
    const admin = await actor("admin");
    const emma = await prisma.user.findFirstOrThrow({ where: { email: email.emma }, include: { roles: true } });
    const superRole = await prisma.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" } });
    await expect(updateUser(admin, emma.id, {
      displayName: emma.displayName, ticketVisibility: "OWN", status: "ACTIVE", roleIds: [...emma.roles.map((r) => r.roleId), superRole.id],
    })).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("Microsoft Entra tenant gate", () => {
  const db = prisma as PrismaClient;
  const iss = (tid: string) => `https://login.microsoftonline.com/${tid}/v2.0`;
  it("rejects tenants that are not registered", async () => {
    const tid = "33333333-3333-4333-8333-333333333333";
    expect(await resolveEntraUser(db, { tid, oid: "44444444-4444-4444-8444-444444444444", iss: iss(tid) })).toEqual({ ok: false, reason: "tenant_not_allowed" });
  });
  it("auto-provisions users of internal tenants with the default role", async () => {
    const tid = "11111111-1111-4111-8111-111111111111";
    const r = await resolveEntraUser(db, { tid, oid: "55555555-5555-4555-8555-555555555555", iss: iss(tid), email: "new.hire@contoso.example", name: "New Hire" });
    expect(r).toMatchObject({ ok: true, created: true });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: (r as { userId: string }).userId }, include: { roles: { include: { role: true } } } });
    expect(u.roles.map((x) => x.role.code)).toEqual(["EMPLOYEE"]);
  });
  it("links a pre-created user in the same tenant by email on first sign-in", async () => {
    const tid = "11111111-1111-4111-8111-111111111111";
    const pre = await prisma.user.findFirstOrThrow({ where: { email: email.lead } });
    expect(pre.entraObjectId).toBeNull();
    const r = await resolveEntraUser(db, { tid, oid: "66666666-6666-4666-8666-666666666666", iss: iss(tid), email: "Lee.Lead@contoso.example" });
    expect(r).toMatchObject({ ok: true, userId: pre.id, created: false });
  });
  it("does NOT link by email across tenants (email domain is not identity)", async () => {
    const tidB = "22222222-2222-4222-8222-222222222222";
    const r = await resolveEntraUser(db, { tid: tidB, oid: "77777777-7777-4777-8777-777777777777", iss: iss(tidB), email: email.admin });
    expect(r.ok && r.created).toBe(true);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: (r as { userId: string }).userId } });
    const realAdmin = await prisma.user.findFirstOrThrow({ where: { email: email.admin, tenant: { entraTenantId: "11111111-1111-4111-8111-111111111111" } } });
    expect(u.id).not.toBe(realAdmin.id);
  });
  it("vendor tenants without auto-provisioning create PENDING accounts", async () => {
    const tid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(await resolveEntraUser(db, { tid, oid: "88888888-8888-4888-8888-888888888888", iss: iss(tid), email: "new@vendor-a.example" })).toEqual({ ok: false, reason: "account_pending" });
  });
  it("disabled tenants are blocked", async () => {
    const admin = await actor("superadmin");
    const t = await prisma.tenant.findUniqueOrThrow({ where: { entraTenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } });
    const res = await import("@/server/services/admin/crud").then((m) => m.setCrudActive(admin, "tenants", t.id, false));
    expect(res.ok).toBe(true);
    expect(await resolveEntraUser(db, { tid: t.entraTenantId, oid: "12121212-1212-4212-8212-121212121212", iss: iss(t.entraTenantId) })).toEqual({ ok: false, reason: "tenant_inactive" });
    const vera = await prisma.user.findFirstOrThrow({ where: { email: email.vendorB } });
    expect(await loadActor(prisma, vera.id)).toBeNull();
    await prisma.tenant.update({ where: { id: t.id }, data: { isActive: true } }); // restore for other suites
  });
});

describe("admin configuration", () => {
  it("admin creates a subcategory that becomes available; non-admins are refused", async () => {
    const admin = await actor("admin");
    const r = await saveCrud(admin, "categories", null, { parentId: await cat("HW"), code: "HW-SCAN", name: "Document Scanner", requiredFields: ["relatedAsset"] });
    expect(r.ok).toBe(true);
    await expect(saveCrud(await actor("agent"), "categories", null, { code: "X", name: "X" })).rejects.toBeInstanceOf(AuthorizationError);
    const dupe = await saveCrud(admin, "categories", null, { code: "HW-SCAN", name: "Dupe" });
    expect(dupe).toMatchObject({ ok: false });
  });
});
