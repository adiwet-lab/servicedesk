import { afterAll, describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../messages/en.json";
import th from "../../messages/th.json";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { createTicket } from "@/server/services/tickets";
import { createArticle, searchArticles, setArticleStatus } from "@/server/services/kb";
import { getOverview, getFilterOptions, parseAnalyticsFilters } from "@/server/services/analytics";
import { runReport } from "@/server/services/reports";
import { loadCrudPage, saveCrud } from "@/server/services/admin/crud";
import { renderNotification } from "@/i18n/notifications";
import { runAction } from "@/server/actions/result";
import { ValidationError } from "@/server/authz/errors";

const E = { emma: "emma@contoso.example", agent: "ana.agent@contoso.example", lead: "lee.lead@contoso.example", admin: "sys.admin@contoso.example" };
async function actor(k: keyof typeof E) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: E[k] } });
  return (await loadActor(prisma, u.id))!;
}
const cat = async (c: string) => (await prisma.category.findUniqueOrThrow({ where: { code: c } })).id;
const uniq = () => Math.random().toString(36).slice(2, 8);
const notify = (locale: "en" | "th") => createTranslator({ locale, messages: locale === "en" ? en : th, namespace: "notify" as never });

afterAll(() => prisma.$disconnect());

describe("notifications", () => {
  it("are stored as key + params and rendered in each viewer's language", async () => {
    const t = await createTicket(await actor("emma"), { subject: `Install drawing software ${uniq()}`, description: "Please install the drawing software on my laptop.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-SW") });
    const n = await prisma.notification.findFirstOrThrow({ where: { ticketId: t.id }, orderBy: { createdAt: "asc" } });
    expect(n.key).toBeTruthy();
    expect(n.params).toBeTruthy();
    const enText = renderNotification(n, notify("en") as never);
    const thText = renderNotification(n, notify("th") as never);
    expect(enText.title).toContain(t.number);
    expect(thText.title).toContain(t.number);
    expect(thText.title).not.toBe(enText.title);
    expect(thText.title).toMatch(/[฀-๿]/);
  });
});

describe("knowledge base in two languages", () => {
  it("finds Thai-only and English-only articles and shows the reader's language with fallback", async () => {
    const tag = uniq();
    const thOnly = await createArticle(await actor("agent"), {
      title: "", body: "", titleTh: `วิธีเชื่อมต่อเครื่องสแกน ${tag}`, bodyTh: "เสียบสาย USB แล้วรอให้ไฟสีเขียวติด จากนั้นลองสแกนอีกครั้ง", type: "HOW_TO",
    });
    const enOnly = await createArticle(await actor("agent"), {
      title: `Scanner pairing guide ${tag}`, body: "Plug in the USB cable and wait for the green light, then scan again.", type: "HOW_TO",
    });
    for (const a of [thOnly, enOnly]) await setArticleStatus(await actor("lead"), a.id, "PUBLISHED");
    const emma = await actor("emma");

    const thHits = await searchArticles(emma, "เครื่องสแกน", { locale: "th" });
    expect(thHits.map((r) => r.id)).toContain(thOnly.id);
    const enHits = await searchArticles(emma, `Scanner pairing ${tag}`, { locale: "en" });
    expect(enHits.map((r) => r.id)).toContain(enOnly.id);

    // A Thai reader sees the English article (fallback) and vice versa.
    const thView = (await searchArticles(emma, tag, { locale: "th" })).find((r) => r.id === enOnly.id);
    expect(thView?.title).toBe(`Scanner pairing guide ${tag}`);
    const enView = (await searchArticles(emma, tag, { locale: "en" })).find((r) => r.id === thOnly.id);
    expect(enView?.title).toBe(`วิธีเชื่อมต่อเครื่องสแกน ${tag}`);
  });

  it("requires a title and body in at least one language", async () => {
    await expect(createArticle(await actor("agent"), { title: "", body: "", type: "FAQ" })).rejects.toBeInstanceOf(ValidationError);
    // Outside a request (jobs, tests) messages fall back to English; validation keys become text.
    const r = await runAction(async () => { throw new ValidationError("Subject must be at least 5 characters", { title: "validation.kbTitleMin" }); });
    expect(r).toEqual({ ok: false, error: "Subject must be at least 5 characters", fieldErrors: { title: "Title must be at least 5 characters." } });
  });
});

describe("configuration names and labels", () => {
  it("dashboards and filter options use Thai names in Thai and English names in English", async () => {
    const admin = await actor("admin");
    await createTicket(await actor("emma"), { subject: `Need a second monitor ${uniq()}`, description: "A second monitor for spreadsheets.", categoryId: await cat("REQ"), subcategoryId: await cat("REQ-SW") });
    const [thOpts, enOpts] = await Promise.all([getFilterOptions(admin, "th"), getFilterOptions(admin, "en")]);
    expect(thOpts.priorities.find((p) => p.code === "P1")?.name).toBe("วิกฤต");
    expect(enOpts.priorities.find((p) => p.code === "P1")?.name).toBe("Critical");
    const o = await getOverview(admin, parseAnalyticsFilters({ range: "30d" }, "th"));
    expect(o.byStatus.length).toBeGreaterThan(0);
    expect(o.byStatus.every((s) => /[฀-๿]/.test(s.name))).toBe(true);
  });

  it("report headers and fixed values follow the requester's language", async () => {
    const admin = await actor("admin");
    const thR = await runReport(admin, "tickets", parseAnalyticsFilters({ range: "30d" }, "th"), 5);
    const enR = await runReport(admin, "tickets", parseAnalyticsFilters({ range: "30d" }, "en"), 5);
    expect(enR.headers[0]).toBe("Ticket");
    expect(thR.headers[0]).toBe("ทิกเก็ต");
    expect(thR.headers.length).toBe(enR.headers.length);
  });

  it("admin CRUD shows Thai labels and Thai validation messages, and saves the Thai name", async () => {
    const admin = await actor("admin");
    const page = await loadCrudPage(admin, "priorities", "th");
    expect(page.title).toBe("ระดับความสำคัญ");
    expect(page.fields.find((f) => f.name === "nameTh")?.label).toBe("ชื่อ (ไทย)");
    const bad = await saveCrud(admin, "priorities", null, { code: "", name: "", level: "", color: "#112233" }, "th");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.values(bad.fieldErrors ?? {}).join(" ")).toContain("กรุณาระบุ");

    const code = `T${uniq().slice(0, 5).toUpperCase()}`;
    const ok = await saveCrud(admin, "priorities", null, { code, name: "Test priority", nameTh: "ทดสอบ", level: "9", color: "#112233" }, "en");
    expect(ok.ok).toBe(true);
    expect((await prisma.priority.findUniqueOrThrow({ where: { code } })).nameTh).toBe("ทดสอบ");
    await prisma.priority.delete({ where: { code } });
  });
});

describe("user language preference", () => {
  it("is stored on the user and loaded with the actor", async () => {
    const u = await prisma.user.findFirstOrThrow({ where: { email: E.lead } });
    const before = u.locale;
    try {
      await prisma.user.update({ where: { id: u.id }, data: { locale: "en" } });
      expect((await loadActor(prisma, u.id))!.locale).toBe("en");
    } finally {
      await prisma.user.update({ where: { id: u.id }, data: { locale: before } });
    }
  });
});
