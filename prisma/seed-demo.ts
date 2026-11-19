/**
 * Optional demo data: creates sample tickets through the real service layer
 * (routing, numbering, SLA, history, audit, notifications) and walks some of
 * them through the workflow. Run after `pnpm db:seed`:  pnpm db:demo
 */
import { PrismaClient } from "@prisma/client";
import { loadActor } from "../src/server/auth/load-actor";
import { assignTicket, changeTicketStatus, createTicket } from "../src/server/services/tickets";

const prisma = new PrismaClient();

const SAMPLES: [string, string, string, string, Partial<Record<string, string>>?][] = [
  ["emp1", "HW", "HW-NB", "Notebook battery drains within one hour", { relatedAsset: "NB-CTR-00412" }],
  ["emp1", "M365", "M365-MAIL", "Cannot send emails with attachments larger than 5MB"],
  ["emp2", "SYS", "SYS-ACC", "Month-end closing report shows wrong totals"],
  ["store", "RTL", "RTL-POS", "POS terminal 3 cannot print receipts", { relatedAsset: "POS-BKK01-03", contactNumber: "+66 81 234 5678" }],
  ["store", "RTL", "RTL-PAY", "Payment terminal rejects contactless cards", { relatedAsset: "EDC-BKK01-01" }],
  ["store", "NW", "NW-WIFI", "Store Wi-Fi drops every 10 minutes"],
  ["fab", "M365", "M365-ACC", "New joiner needs Microsoft 365 account"],
  ["emp1", "REQ", "REQ-SW", "Please install Power BI Desktop"],
  ["emp2", "NW", "NW-VPN", "VPN disconnects when working from home"],
  ["store", "NW", "NW-INET", "Internet outage at Siam store"],
  ["emp1", "HW", "HW-PR", "Finance printer paper jam on every job", { relatedAsset: "PRN-HQ-F5-02" }],
  ["viewer", "SYS", "SYS-ERP", "ERP dashboard is very slow in the morning"],
  ["emp2", "REQ", "REQ-ACC", "Access to shared Finance folder for new analyst"],
  ["fab", "HW", "HW-MN", "Second monitor flickering", { relatedAsset: "MON-FHQ-0091" }],
];

async function actorFor(key: string) {
  const emails: Record<string, string> = {
    emp1: "emma@contoso.example", emp2: "ethan@contoso.example", store: "somchai@contoso.example", fab: "fiona@fabrikam.example",
    viewer: "mia.manager@contoso.example", agent: "ana.agent@contoso.example", lead: "lee.lead@contoso.example",
    retail: "rita.retail@contoso.example", infra: "ivan.infra@contoso.example", vendorA: "victor@vendor-a.example",
  };
  const u = await prisma.user.findFirstOrThrow({ where: { email: emails[key] } });
  const a = await loadActor(prisma, u.id);
  if (!a) throw new Error(`Actor ${key} not active`);
  return a;
}

async function main() {
  if ((await prisma.ticket.count()) > 0) {
    console.log("Tickets already exist — skipping demo data.");
    return;
  }
  const cat = async (code: string) => (await prisma.category.findUniqueOrThrow({ where: { code } })).id;
  const status = async (code: string) => (await prisma.ticketStatus.findUniqueOrThrow({ where: { code } })).id;
  const created: { id: string; number: string; key: string }[] = [];

  for (const [who, main, sub, subject, extra] of SAMPLES) {
    const actor = await actorFor(who);
    const t = await createTicket(actor, {
      subject, description: `${subject}.\n\nReported via demo data generator. Steps tried: restarted device.`,
      categoryId: await cat(main), subcategoryId: await cat(sub), ...extra,
    });
    created.push({ ...t, key: sub });
  }

  const lead = await actorFor("lead");
  const agent = await actorFor("agent");
  const retail = await actorFor("retail");
  const it = await prisma.supportTeam.findUniqueOrThrow({ where: { code: "IT-SUPPORT" } });
  const infra = await prisma.supportTeam.findUniqueOrThrow({ where: { code: "INFRA" } });

  // Walk a few tickets through the workflow
  const nb = created.find((c) => c.key === "HW-NB")!;
  await assignTicket(lead, { ticketId: nb.id, agentId: agent.id, reason: "Hardware queue" });
  await changeTicketStatus(agent, { ticketId: nb.id, toStatusId: await status("IN_PROGRESS") });
  await changeTicketStatus(agent, { ticketId: nb.id, toStatusId: await status("RESOLVED"), resolutionSummary: "Battery replaced under warranty." });

  const prn = created.find((c) => c.key === "HW-PR")!;
  await assignTicket(lead, { ticketId: prn.id, agentId: agent.id });
  await changeTicketStatus(agent, { ticketId: prn.id, toStatusId: await status("WAITING_USER"), reason: "Please confirm the printer model on the label." });

  const sw = created.find((c) => c.key === "REQ-SW")!;
  await assignTicket(lead, { ticketId: sw.id, agentId: lead.id });

  const pos = created.find((c) => c.key === "RTL-POS")!;
  await assignTicket(retail, { ticketId: pos.id, agentId: retail.id });
  await changeTicketStatus(retail, { ticketId: pos.id, toStatusId: await status("IN_PROGRESS") });

  // Transfer example: VPN ticket landed in Infra; transfer a hardware ticket from IT Support to Infra
  const mon = created.find((c) => c.key === "HW-MN")!;
  await assignTicket(lead, { ticketId: mon.id, teamId: infra.id, reason: "Docking station issue — infrastructure owns docks" });
  void it;

  // Spread creation dates over the last 3 weeks for nicer trends/aging
  const all = await prisma.ticket.findMany({ orderBy: { createdAt: "asc" } });
  for (const [i, t] of all.entries()) {
    const shiftMs = Math.round((all.length - i) * 1.4 * 86400000);
    const shift = (d: Date | null) => (d ? new Date(d.getTime() - shiftMs) : null);
    await prisma.ticket.update({
      where: { id: t.id },
      data: { createdAt: shift(t.createdAt)!, responseDueAt: shift(t.responseDueAt), resolutionDueAt: shift(t.resolutionDueAt),
        firstResponseAt: shift(t.firstResponseAt), resolvedAt: t.resolvedAt ? new Date(t.createdAt.getTime() - shiftMs + 2 * 86400000) : null },
    });
    await prisma.$executeRaw`UPDATE "TicketHistory" SET "createdAt" = "createdAt" - (${shiftMs}::bigint * interval '1 millisecond') WHERE "ticketId" = ${t.id}`;
    await prisma.$executeRaw`UPDATE "TicketAssignment" SET "createdAt" = "createdAt" - (${shiftMs}::bigint * interval '1 millisecond') WHERE "ticketId" = ${t.id}`;
  }
  console.log(`✅ Created ${created.length} demo tickets.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
