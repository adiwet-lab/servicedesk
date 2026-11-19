import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { changeTicketStatus, createTicket, readAttachment } from "@/server/services/tickets";
import { chatInbox, listMessages, markTicketRead, postMessage, totalUnreadMessages, unreadCounts } from "@/server/services/messages";
import { saveSystemSettings } from "@/server/services/admin/system";
import { createTask } from "@/server/services/tasks";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";

const E = {
  emma: "emma@contoso.example", ethan: "ethan@contoso.example", fiona: "fiona@fabrikam.example", agent: "ana.agent@contoso.example",
  lead: "lee.lead@contoso.example", admin: "sys.admin@contoso.example", vendorA: "victor@vendor-a.example",
};
async function actor(k: keyof typeof E) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: E[k] } });
  return (await loadActor(prisma, u.id))!;
}
const id = {
  cat: async (c: string) => (await prisma.category.findUniqueOrThrow({ where: { code: c } })).id,
  status: async (c: string) => (await prisma.ticketStatus.findUniqueOrThrow({ where: { code: c } })).id,
  team: async (c: string) => (await prisma.supportTeam.findUniqueOrThrow({ where: { code: c } })).id,
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let ticket: { id: string; number: string };

beforeAll(async () => {
  ticket = await createTicket(await actor("emma"), {
    subject: "Outlook keeps asking for password", description: "Outlook prompts for credentials every 10 minutes.",
    categoryId: await id.cat("REQ"), subcategoryId: await id.cat("REQ-ACC"),
  });
  const lee = await actor("lead");
  const ana = await actor("agent");
  const { assignTicket } = await import("@/server/services/tickets");
  await assignTicket(lee, { ticketId: ticket.id, agentId: ana.id });
});
afterAll(() => prisma.$disconnect());

describe("public conversation", () => {
  it("requester and agent exchange messages; first staff reply sets first response", async () => {
    const emma = await actor("emma");
    const ana = await actor("agent");
    await prisma.ticket.update({ where: { id: ticket.id }, data: { firstResponseAt: null } });
    await postMessage(emma, ticket.id, { body: "It started after the password change." });
    await postMessage(ana, ticket.id, { body: "Please sign out of all Office apps and back in." });
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(t.firstResponseAt).not.toBeNull();
    const list = await listMessages(emma, ticket.id);
    expect(list.messages.map((m) => m.body)).toEqual(["It started after the password change.", "Please sign out of all Office apps and back in."]);
    expect(list.messages[1]).toMatchObject({ mine: false, sender: { role: "Support" }, unread: true });
    expect(await prisma.auditLog.count({ where: { ticketId: ticket.id, action: "CHAT_MESSAGE" } })).toBe(2);
  });
  it("notifications are coalesced while unread", async () => {
    const emma = await actor("emma");
    const ana = await actor("agent");
    await postMessage(ana, ticket.id, { body: "Also clear the credential manager." });
    const n = await prisma.notification.findMany({ where: { userId: emma.id, ticketId: ticket.id, type: "NEW_MESSAGE", readAt: null } });
    expect(n).toHaveLength(1);
    expect(n[0]!.body).toContain("credential manager");
  });
  it("unread counts and mark-read", async () => {
    const emma = await actor("emma");
    expect((await unreadCounts(emma, [ticket.id]))[ticket.id]).toBe(2);
    expect(await totalUnreadMessages(emma)).toBeGreaterThanOrEqual(2);
    await markTicketRead(emma, ticket.id);
    expect((await unreadCounts(emma, [ticket.id]))[ticket.id] ?? 0).toBe(0);
    expect(await prisma.notification.count({ where: { userId: emma.id, ticketId: ticket.id, type: "NEW_MESSAGE", readAt: null } })).toBe(0);
    const ana = await actor("agent");
    const mine = (await listMessages(ana, ticket.id)).messages.filter((m) => m.mine);
    expect(mine.every((m) => m.seenBy.includes("Emma Employee"))).toBe(true);
  });
  it("empty messages and oversize text are rejected", async () => {
    await expect(postMessage(await actor("emma"), ticket.id, { body: "   " })).rejects.toBeInstanceOf(ValidationError);
    await expect(postMessage(await actor("emma"), ticket.id, { body: "x".repeat(10_001) })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("internal notes", () => {
  it("are visible to staff but never to the requester (list, search, inbox, attachments)", async () => {
    const ana = await actor("agent");
    const emma = await actor("emma");
    await postMessage(ana, ticket.id, { type: "INTERNAL", body: "Secret: user's mailbox is on legacy server" }, [{ name: "trace.png", size: PNG.length, data: PNG }]);
    expect((await listMessages(ana, ticket.id)).messages.some((m) => m.type === "INTERNAL")).toBe(true);
    const visible = await listMessages(emma, ticket.id);
    expect(visible.messages.some((m) => m.type === "INTERNAL" || m.body.includes("Secret"))).toBe(false);
    expect((await listMessages(emma, ticket.id, { q: "Secret" })).messages).toHaveLength(0);
    const inbox = await chatInbox(emma, { q: "legacy server" });
    expect(inbox.rows).toHaveLength(0);
    const inboxAll = await chatInbox(emma, {});
    expect(inboxAll.rows.find((r) => r.ticketId === ticket.id)?.preview).not.toContain("Secret");
    const att = await prisma.ticketAttachment.findFirstOrThrow({ where: { message: { ticketId: ticket.id, type: "INTERNAL" } } });
    await expect(readAttachment(emma, att.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await readAttachment(ana, att.id)).att.id).toBe(att.id);
    expect((await unreadCounts(emma, [ticket.id]))[ticket.id] ?? 0).toBe(0); // internal notes don't count for requester
    expect(await prisma.notification.count({ where: { userId: emma.id, body: { contains: "Secret" } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { ticketId: ticket.id, action: "INTERNAL_NOTE" } })).toBe(1);
  });
  it("requesters and vendors cannot write internal notes", async () => {
    await expect(postMessage(await actor("emma"), ticket.id, { type: "INTERNAL", body: "hi" })).rejects.toBeInstanceOf(AuthorizationError);
    const lee = await actor("lead");
    await createTask(lee, ticket.id, { title: "Check MSP proxy", teamId: await id.team("VENDOR-A") });
    const victor = await actor("vendorA");
    await expect(postMessage(victor, ticket.id, { type: "INTERNAL", body: "hi" })).rejects.toBeInstanceOf(AuthorizationError);
    // but the vendor task team can take part in the public conversation and never sees internal notes
    await postMessage(victor, ticket.id, { body: "Proxy logs look clean." });
    expect((await listMessages(victor, ticket.id)).messages.some((m) => m.type === "INTERNAL")).toBe(false);
  });
});

describe("participation rules", () => {
  it("department colleagues can read but not post; unrelated users cannot read", async () => {
    const ethan = await actor("ethan");
    expect((await listMessages(ethan, ticket.id)).messages.length).toBeGreaterThan(0);
    await expect(postMessage(ethan, ticket.id, { body: "Same for me" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listMessages(await actor("fiona"), ticket.id)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("requester reply resumes a waiting ticket", async () => {
    const ana = await actor("agent");
    await changeTicketStatus(ana, { ticketId: ticket.id, toStatusId: await id.status("IN_PROGRESS") });
    await changeTicketStatus(ana, { ticketId: ticket.id, toStatusId: await id.status("WAITING_USER"), reason: "Please confirm" });
    await postMessage(await actor("emma"), ticket.id, { body: "Confirmed, it works now." });
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { status: true } });
    expect(t.status.code).toBe("IN_PROGRESS");
    expect(t.slaPausedAt).toBeNull();
    expect(await prisma.ticketHistory.count({ where: { ticketId: ticket.id, reason: "Auto on requester reply" } })).toBe(1);
  });
  it("disabled notification types are suppressed", async () => {
    const admin = await actor("admin");
    await saveSystemSettings(admin, { "notifications.disabledTypes": ["NEW_MESSAGE"] });
    const ana = await actor("agent");
    const before = await prisma.notification.count({ where: { userId: ana.id, type: "NEW_MESSAGE" } });
    await prisma.notification.updateMany({ where: { userId: ana.id }, data: { readAt: new Date() } });
    await postMessage(await actor("emma"), ticket.id, { body: "One more thing" });
    expect(await prisma.notification.count({ where: { userId: ana.id, type: "NEW_MESSAGE" } })).toBe(before);
    await saveSystemSettings(admin, { "notifications.disabledTypes": [] });
  });
  it("closed tickets are read-only", async () => {
    const ana = await actor("agent");
    await prisma.ticketTask.updateMany({ where: { ticketId: ticket.id }, data: { status: "COMPLETED" } });
    await changeTicketStatus(ana, { ticketId: ticket.id, toStatusId: await id.status("RESOLVED"), resolutionSummary: "Credential cache cleared" });
    await changeTicketStatus(await actor("emma"), { ticketId: ticket.id, toStatusId: await id.status("CLOSED") });
    await expect(postMessage(await actor("emma"), ticket.id, { body: "thanks" })).rejects.toThrow(/closed/);
  });
});
