import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import {
  chatCaseHeader, chatQueue, chatSubject, claimChat, followUpList, getChatFilter, saveChatFilter, startChatCase, unclaimedChatCount,
} from "@/server/services/chat-cases";
import { assignTicket, changeTicketStatus } from "@/server/services/tickets";
import { listMessages, postMessage } from "@/server/services/messages";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";

const E = {
  emma: "emma@contoso.example", agent: "ana.agent@contoso.example", lead: "lee.lead@contoso.example", infra: "ivan.infra@contoso.example",
  vendorA: "victor@vendor-a.example", admin: "sys.admin@contoso.example",
};
async function actor(k: keyof typeof E) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: E[k] } });
  return (await loadActor(prisma, u.id))!;
}
const cat = async (c: string) => (await prisma.category.findUniqueOrThrow({ where: { code: c } })).id;
const team = async (c: string) => (await prisma.supportTeam.findUniqueOrThrow({ where: { code: c } })).id;
const status = async (c: string) => (await prisma.ticketStatus.findUniqueOrThrow({ where: { code: c } })).id;
const uniq = () => Math.random().toString(36).slice(2, 8);
const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

async function wifiCase(text = `Wi-Fi drops on floor 5 ${uniq()}\nsince this morning`, files: { name: string; size: number; data: Buffer }[] = []) {
  return startChatCase(await actor("emma"), { categoryId: await cat("NW"), subcategoryId: await cat("NW-WIFI"), body: text }, files);
}

afterAll(() => prisma.$disconnect());

describe("starting a chat case", () => {
  it("creates a routed CHAT ticket whose details (and files) are the first chat message", async () => {
    const r = await wifiCase(undefined, [{ name: "screen.png", size: png.length, data: png }]);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: r.id }, include: { ownerTeam: true, messages: { include: { attachments: true } } } });
    expect(t).toMatchObject({ channel: "CHAT", assignedAgentId: null });
    expect(t.ownerTeam?.code).toBe("INFRA");
    expect(t.subject).toMatch(/^Wi-Fi drops on floor 5/);
    expect(t.responseDueAt).not.toBeNull();
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]!.body).toContain("since this morning");
    expect(t.messages[0]!.attachments.map((a) => a.fileName)).toEqual(["screen.png"]);
    const msgs = await listMessages(await actor("emma"), r.id);
    expect(msgs.messages.length).toBe(1);
  });

  it("accepts a short first message (chat style), naming the case after the subcategory", async () => {
    const r = await startChatCase(await actor("emma"), { categoryId: await cat("NW"), subcategoryId: await cat("NW-WIFI"), body: "เทส" });
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: r.id }, include: { messages: true } });
    expect(t.subject).toBe("Wi-Fi: เทส");
    expect(t.description).toBe("เทส");
    expect(t.messages[0]!.body).toBe("เทส");
  });

  it("still needs a message or a file", async () => {
    await expect(startChatCase(await actor("emma"), { categoryId: await cat("NW"), subcategoryId: await cat("NW-WIFI"), body: "  " }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("enforces category rules (subcategory required) like the form", async () => {
    await expect(startChatCase(await actor("emma"), { categoryId: await cat("NW"), body: "No subcategory chosen here" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("derives a readable subject from the first line", () => {
    expect(chatSubject("  \nPrinter jams on every page\nmore", "Printer")).toBe("Printer jams on every page");
    expect(chatSubject("help", "Printer")).toBe("Printer: help");
    expect(chatSubject("x".repeat(120), "P").length).toBeLessThanOrEqual(80);
  });
});

describe("chat queue and claiming", () => {
  it("every internal agent sees unclaimed chats; vendors and employees cannot use the queue", async () => {
    const r = await wifiCase();
    const ana = await actor("agent"); // IT Support — not the routed team
    expect((await chatQueue(ana, { view: "unclaimed" })).rows.map((x) => x.ticketId)).toContain(r.id);
    expect((await chatCaseHeader(ana, r.id)).unclaimed).toBe(true);
    await expect(chatQueue(await actor("vendorA"), {})).rejects.toBeInstanceOf(AuthorizationError);
    await expect(chatQueue(await actor("emma"), {})).rejects.toBeInstanceOf(AuthorizationError);
    await expect(chatCaseHeader(await actor("vendorA"), r.id)).rejects.toThrow();
  });

  it("claiming assigns the agent and their team; a second claim is refused", async () => {
    const r = await wifiCase();
    const ana = await actor("agent");
    const c = await claimChat(ana, r.id);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: r.id }, include: { status: true } });
    expect(t.assignedAgentId).toBe(ana.id);
    expect(t.ownerTeamId).toBe(c.teamId);
    expect(t.ownerTeamId).toBe(await team("IT-SUPPORT"));
    expect(t.status.code).toBe("ASSIGNED");
    expect(await prisma.ticketAssignment.count({ where: { ticketId: r.id, reason: "Claimed from chat" } })).toBe(1);
    expect(await prisma.notification.count({ where: { ticketId: r.id, key: "chatClaimed" } })).toBe(1);
    await expect(claimChat(await actor("infra"), r.id)).rejects.toThrow(/already been claimed/);
    // No longer in the shared queue, but in the agent's own view
    expect((await chatQueue(ana, { view: "unclaimed" })).rows.map((x) => x.ticketId)).not.toContain(r.id);
    expect((await chatQueue(ana, { view: "mine" })).rows.map((x) => x.ticketId)).toContain(r.id);
  });

  it("an agent of the routed team keeps the team when claiming", async () => {
    const r = await wifiCase();
    await claimChat(await actor("infra"), r.id);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: r.id } })).ownerTeamId).toBe(await team("INFRA"));
  });

  it("vendors see the chat once it is assigned to their team, then can reply", async () => {
    const r = await wifiCase();
    await expect(chatCaseHeader(await actor("vendorA"), r.id)).rejects.toThrow();
    await assignTicket(await actor("admin"), { ticketId: r.id, teamId: await team("VENDOR-A"), reason: "Router at branch — MSP" });
    expect((await chatCaseHeader(await actor("vendorA"), r.id)).number).toBeTruthy();
    await postMessage(await actor("vendorA"), r.id, { body: "We will check the access point." });
    expect((await listMessages(await actor("emma"), r.id)).messages.map((m) => m.body)).toContain("We will check the access point.");
  });

  it("filters by category, branch and status; the saved default filter round-trips", async () => {
    const r = await wifiCase();
    const ana = await actor("agent");
    const hw = await cat("HW");
    expect((await chatQueue(ana, { view: "unclaimed", categoryIds: [hw] })).rows.map((x) => x.ticketId)).not.toContain(r.id);
    expect((await chatQueue(ana, { view: "unclaimed", categoryIds: [await cat("NW")] })).rows.map((x) => x.ticketId)).toContain(r.id);
    const lee = await actor("lead");
    const before = await unclaimedChatCount(lee);
    const saved = await saveChatFilter(lee, { view: "all", categoryIds: [hw] });
    expect(await getChatFilter(lee)).toEqual(saved);
    expect(await unclaimedChatCount(lee)).toBeLessThanOrEqual(before);
    await saveChatFilter(lee, {});
    await expect(saveChatFilter(await actor("emma"), {})).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("following up", () => {
  it("lists the requester's open cases only, and closed cases drop out", async () => {
    const r = await wifiCase();
    const emma = await actor("emma");
    expect((await followUpList(emma)).map((x) => x.id)).toContain(r.id);
    const ana = await actor("agent");
    await claimChat(ana, r.id);
    await changeTicketStatus(ana, { ticketId: r.id, toStatusId: await status("IN_PROGRESS") });
    await changeTicketStatus(ana, { ticketId: r.id, toStatusId: await status("RESOLVED"), resolutionSummary: "Replaced the access point." });
    await changeTicketStatus(emma, { ticketId: r.id, toStatusId: await status("CLOSED") });
    expect((await followUpList(emma)).map((x) => x.id)).not.toContain(r.id);
  });
});
