import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { assignTicket, changeTicketStatus, createTicket } from "@/server/services/tickets";
import {
  createArticle, createArticleFromTicket, getArticle, giveFeedback, helpCenterHome, listArticlesForAdmin, relatedArticlesForTicket,
  searchArticles, setArticleStatus, suggestArticles, updateArticle,
} from "@/server/services/kb";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";

const E = {
  emma: "emma@contoso.example", fiona: "fiona@fabrikam.example", agent: "ana.agent@contoso.example", lead: "lee.lead@contoso.example",
  admin: "sys.admin@contoso.example", vendorA: "victor@vendor-a.example", mia: "mia.manager@contoso.example", infra: "ivan.infra@contoso.example",
};
async function actor(k: keyof typeof E) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: E[k] } });
  return (await loadActor(prisma, u.id))!;
}
const cat = async (c: string) => (await prisma.category.findUniqueOrThrow({ where: { code: c } })).id;
const status = async (c: string) => (await prisma.ticketStatus.findUniqueOrThrow({ where: { code: c } })).id;
const uniq = () => Math.random().toString(36).slice(2, 8);
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

async function article(over: Record<string, unknown> = {}, publish = true) {
  const a = await createArticle(await actor("agent"), {
    title: `Outlook keeps asking for password ${uniq()}`, summary: "Fix repeated credential prompts.",
    body: "## Solution\n\n1. Close Outlook.\n2. Remove the cached credential in Credential Manager.", type: "TROUBLESHOOTING", ...over,
  });
  if (publish) await setArticleStatus(await actor("lead"), a.id, "PUBLISHED");
  return a;
}
afterAll(() => prisma.$disconnect());

describe("authoring permissions", () => {
  it("agents write drafts; only publishers publish; employees and vendors cannot write", async () => {
    const a = await article({}, false);
    expect(a.number).toMatch(/^KB-\d{6}$/);
    expect(a.status).toBe("DRAFT");
    await expect(setArticleStatus(await actor("agent"), a.id, "PUBLISHED")).rejects.toBeInstanceOf(AuthorizationError);
    await expect(createArticle(await actor("emma"), { title: "Employee article", body: "x".repeat(30) })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(createArticle(await actor("vendorA"), { title: "Vendor article", body: "x".repeat(30) })).rejects.toBeInstanceOf(AuthorizationError);
    await setArticleStatus(await actor("lead"), a.id, "PUBLISHED");
    const row = await prisma.kbArticle.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.status).toBe("PUBLISHED");
    expect(row.publishedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: a.id, action: { in: ["KB_CREATED", "KB_PUBLISHED"] } } })).toBe(2);
  });

  it("writers edit drafts only; publishers edit published; version + audit note; optimistic lock", async () => {
    const a = await article();
    await expect(updateArticle(await actor("agent"), a.id, { title: "Agent edits published", body: "y".repeat(30) })).rejects.toBeInstanceOf(AuthorizationError);
    await updateArticle(await actor("lead"), a.id, { title: "Lead edits published article", body: "z".repeat(30), changeNote: "typo" });
    const row = await prisma.kbArticle.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.version).toBe(2);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: a.id, action: "KB_UPDATED" } });
    expect(log.newValue).toMatchObject({ version: 2, note: "typo" });
    await expect(updateArticle(await actor("lead"), a.id, { title: "x", body: "short" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("visibility", () => {
  it("employees never see drafts, archived or support-only; staff see support-only; vendors don't", async () => {
    const tag = uniq();
    const pub = await article({ title: `Visible ${tag} article` });
    const draft = await article({ title: `Draft ${tag} article` }, false);
    const internal = await article({ title: `Internal ${tag} article`, visibility: "SUPPORT_ONLY" });
    const archived = await article({ title: `Archived ${tag} article` });
    await setArticleStatus(await actor("lead"), archived.id, "ARCHIVED");

    expect(titles(await searchArticles(await actor("emma"), tag)).sort()).toEqual([`Visible ${tag} article`]);
    expect(titles(await searchArticles(await actor("vendorA"), tag))).toEqual([`Visible ${tag} article`]);
    expect(titles(await searchArticles(await actor("agent"), tag)).sort()).toEqual([`Internal ${tag} article`, `Visible ${tag} article`]);
    // Management view shows every status to writers only.
    expect((await listArticlesForAdmin(await actor("agent"), { q: tag })).length).toBe(4);
    await expect(listArticlesForAdmin(await actor("emma"), {})).rejects.toBeInstanceOf(AuthorizationError);

    for (const a of [draft, internal, archived]) await expect(getArticle(await actor("emma"), a.number)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getArticle(await actor("vendorA"), internal.number)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getArticle(await actor("emma"), pub.number)).title).toBe(`Visible ${tag} article`);
    const home = await helpCenterHome(await actor("emma"));
    expect(home.popular.every((a) => a.status === "PUBLISHED" && a.visibility === "EMPLOYEES")).toBe(true);
  });

  it("counts views only for published articles", async () => {
    const a = await article();
    await getArticle(await actor("emma"), a.number, { countView: true });
    await getArticle(await actor("emma"), a.number, { countView: true });
    expect((await prisma.kbArticle.findUniqueOrThrow({ where: { id: a.id } })).viewCount).toBe(2);
  });
});

describe("search", () => {
  it("full-text, partial-word and Thai substring search; LIKE wildcards are literal", async () => {
    const tag = uniq();
    await article({ title: `Configure multifactor authentication ${tag}`, body: "Open the Authenticator app and scan the QR code shown on screen." });
    await article({ title: `ตั้งค่าเครื่องพิมพ์ ${tag}`, summary: "วิธีตั้งค่าเครื่องพิมพ์สำหรับสาขา", body: "ขั้นตอนการตั้งค่าเครื่องพิมพ์ในสาขา" });
    const emma = await actor("emma");
    expect(titles(await searchArticles(emma, `authenticator ${tag}`))).toEqual([`Configure multifactor authentication ${tag}`]); // FTS on body
    expect(titles(await searchArticles(emma, `multifact`))).toContain(`Configure multifactor authentication ${tag}`); // partial word
    expect(titles(await searchArticles(emma, "เครื่องพิมพ์"))).toContain(`ตั้งค่าเครื่องพิมพ์ ${tag}`); // Thai substring
    expect(await searchArticles(emma, "%%%")).toEqual([]);
    expect(await searchArticles(emma, "_")).toEqual([]);
  });

  it("title matches rank above body-only matches", async () => {
    const tag = uniq();
    await article({ title: `Generic help ${tag}`, body: `Mentions zebracrossing${tag} only in the body text here.` });
    await article({ title: `zebracrossing${tag} setup guide`, body: "Some unrelated body text for ranking." });
    expect(titles(await searchArticles(await actor("emma"), `zebracrossing${tag}`))[0]).toBe(`zebracrossing${tag} setup guide`);
  });

  it("deflection suggestions match any word and respect visibility", async () => {
    const tag = uniq();
    await article({ title: `Shared mailbox missing in Outlook ${tag}` });
    await article({ title: `Shared mailbox permissions internal ${tag}`, visibility: "SUPPORT_ONLY" });
    const s = await suggestArticles(await actor("emma"), `my shared mailbox ${tag} disappeared today`);
    expect(titles(s)).toContain(`Shared mailbox missing in Outlook ${tag}`);
    expect(titles(s)).not.toContain(`Shared mailbox permissions internal ${tag}`);
    expect(await suggestArticles(await actor("emma"), "a")).toEqual([]);
  });
});

describe("convert from ticket", () => {
  async function resolvedTicket(subject: string, extra: Record<string, unknown> = {}) {
    const t = await createTicket(await actor("emma"), { subject, description: "Outlook asks for my password every 5 minutes.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-SW"), ...extra });
    const ana = await actor("agent");
    await assignTicket(await actor("lead"), { ticketId: t.id, agentId: ana.id });
    await changeTicketStatus(ana, { ticketId: t.id, toStatusId: await status("IN_PROGRESS") });
    await changeTicketStatus(ana, { ticketId: t.id, toStatusId: await status("RESOLVED"), resolutionSummary: "Cleared cached credentials and re-added the profile." });
    return t;
  }

  it("creates a support-only draft with symptoms + solution, linked to the ticket", async () => {
    const t = await resolvedTicket(`Outlook password loop ${uniq()}`);
    const ana = await actor("agent");
    const a = await createArticleFromTicket(ana, t.id);
    const row = await prisma.kbArticle.findUniqueOrThrow({ where: { id: a.id }, include: { tickets: true } });
    expect(row).toMatchObject({ status: "DRAFT", visibility: "SUPPORT_ONLY", type: "TROUBLESHOOTING", sourceTicketId: t.id, categoryId: await cat("REQ-SW") });
    expect(row.body).toContain("## Symptoms");
    expect(row.body).toContain("Cleared cached credentials");
    expect(row.tickets.map((x) => x.ticketId)).toEqual([t.id]);
    expect(await prisma.ticketHistory.count({ where: { ticketId: t.id, action: "KB_ARTICLE_CREATED" } })).toBe(1);
    expect((await relatedArticlesForTicket(ana, t.id)).find((r) => r.id === a.id)?.linked).toBe(true);
    // The requester does not see the draft as related.
    expect((await relatedArticlesForTicket(await actor("emma"), t.id)).find((r) => r.id === a.id)).toBeUndefined();
  });

  it("refuses unresolved, confidential, out-of-scope tickets and non-writers", async () => {
    const open = await createTicket(await actor("emma"), { subject: `Still open ${uniq()}`, description: "Open ticket body text.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-SW") });
    await expect(createArticleFromTicket(await actor("lead"), open.id)).rejects.toThrow(/resolved or closed/);
    const conf = await resolvedTicket(`Confidential ${uniq()}`, { isConfidential: "on" });
    await expect(createArticleFromTicket(await actor("agent"), conf.id)).rejects.toThrow(/Confidential/);
    const t = await resolvedTicket(`Scope check ${uniq()}`);
    await expect(createArticleFromTicket(await actor("infra"), t.id)).rejects.toBeInstanceOf(NotFoundError); // other team
    await expect(createArticleFromTicket(await actor("emma"), t.id)).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("feedback", () => {
  it("one vote per user (changeable); counters recomputed; hidden articles refused", async () => {
    const a = await article();
    await giveFeedback(await actor("emma"), a.id, { helpful: "true" });
    await giveFeedback(await actor("emma"), a.id, { helpful: "true" });
    await giveFeedback(await actor("mia"), a.id, { helpful: "false", comment: "Did not work" });
    let row = await prisma.kbArticle.findUniqueOrThrow({ where: { id: a.id } });
    expect([row.helpfulYes, row.helpfulNo]).toEqual([1, 1]);
    await giveFeedback(await actor("mia"), a.id, { helpful: "true" });
    row = await prisma.kbArticle.findUniqueOrThrow({ where: { id: a.id } });
    expect([row.helpfulYes, row.helpfulNo]).toEqual([2, 0]);
    expect((await getArticle(await actor("emma"), a.number)).myFeedback).toBe(true);

    const internal = await article({ visibility: "SUPPORT_ONLY" });
    await expect(giveFeedback(await actor("emma"), internal.id, { helpful: "true" })).rejects.toBeInstanceOf(NotFoundError);
    await giveFeedback(await actor("emma"), a.id, { helpful: "true" }, { deflected: true });
    expect(await prisma.auditLog.count({ where: { entityId: a.id, action: "KB_DEFLECTED" } })).toBe(1);
  });

  it("stores article bodies verbatim (rendering escapes them)", async () => {
    const a = await article({ body: "<script>alert(1)</script> [x](javascript:alert(1)) and more text" });
    expect((await prisma.kbArticle.findUniqueOrThrow({ where: { id: a.id } })).body).toContain("<script>");
  });
});
