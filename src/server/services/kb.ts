import { z } from "zod";
import { Prisma, type KbStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { transaction } from "@/server/db-tx";
import type { Actor } from "@/server/authz/actor";
import { isVendor } from "@/server/authz/actor";
import { can, canAny } from "@/server/authz/guards";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { canWorkTicket, ticketScopeWhere } from "@/server/authz/scope";
import { enforceRateLimit } from "@/server/ratelimit";
import { markdownToText } from "@/lib/markdown";
import { ln, pickLang } from "@/lib/localized";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { audit } from "./audit";
import { nextNumber } from "./numbering";

export const KB_TYPE_LABEL = { FAQ: "FAQ", TROUBLESHOOTING: "Troubleshooting", HOW_TO: "How-to" } as const;
export const KB_STATUS_LABEL = { DRAFT: "Draft", PUBLISHED: "Published", ARCHIVED: "Archived" } as const;

// ───────────────────────────── Visibility ─────────────────────────────

/** Internal support staff may read support-only articles. Vendors never do. */
export function isKbStaff(actor: Actor) {
  return !isVendor(actor) && canAny(actor, [P.TICKET_READ_TEAM, P.TICKET_READ_ALL, P.KB_WRITE]);
}
export function canWriteKb(actor: Actor) { return !isVendor(actor) && can(actor, P.KB_WRITE); }
export function canPublishKb(actor: Actor) { return !isVendor(actor) && can(actor, P.KB_PUBLISH); }

/** Articles the actor may read. Writers/publishers see drafts and archived too (management view). */
export function kbReadWhere(actor: Actor, opts: { management?: boolean } = {}): Prisma.KbArticleWhereInput {
  if (opts.management && (canWriteKb(actor) || canPublishKb(actor))) return {};
  return { status: "PUBLISHED", ...(isKbStaff(actor) ? {} : { visibility: "EMPLOYEES" }) };
}

function kbReadSql(actor: Actor, management: boolean): Prisma.Sql {
  if (management && (canWriteKb(actor) || canPublishKb(actor))) return Prisma.sql`TRUE`;
  return isKbStaff(actor)
    ? Prisma.sql`a."status" = 'PUBLISHED'`
    : Prisma.sql`a."status" = 'PUBLISHED' AND a."visibility" = 'EMPLOYEES'`;
}

// ───────────────────────────── Search ─────────────────────────────

const TSV = Prisma.sql`to_tsvector('simple',
    coalesce(a."title", '') || ' ' || coalesce(a."summary", '') || ' ' || coalesce(a."body", '') || ' ' ||
    coalesce(a."titleTh", '') || ' ' || coalesce(a."summaryTh", '') || ' ' || coalesce(a."bodyTh", ''))`;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
/** Word tokens (letters/digits in any script) for OR-queries; capped to keep the query cheap. */
export function searchTerms(q: string, max = 12): string[] {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return [...new Set(words)].slice(0, max);
}

export interface KbSearchOptions { categoryId?: string; type?: keyof typeof KB_TYPE_LABEL; limit?: number; management?: boolean; status?: KbStatus; match?: "all" | "any"; locale?: Locale }

/**
 * Ranked search: Postgres full text (simple config, GIN-indexed) OR case-insensitive
 * substring on title/summary/body (covers Thai, which has no word spaces, and partial words).
 * Title hits rank first, then FTS rank, then popularity.
 */
export async function searchArticleIds(actor: Actor, q: string, o: KbSearchOptions = {}): Promise<string[]> {
  const query = q.trim().slice(0, 200);
  const limit = Math.min(Math.max(o.limit ?? 20, 1), 50);
  const conds: Prisma.Sql[] = [kbReadSql(actor, !!o.management)];
  if (o.status) conds.push(Prisma.sql`a."status" = ${o.status}::"KbStatus"`);
  if (o.type) conds.push(Prisma.sql`a."type" = ${o.type}::"KbArticleType"`);
  if (o.categoryId) conds.push(Prisma.sql`(a."categoryId" = ${o.categoryId} OR a."categoryId" IN (SELECT c."id" FROM "Category" c WHERE c."parentId" = ${o.categoryId}))`);

  if (!query) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT a."id" FROM "KbArticle" a WHERE ${Prisma.join(conds, " AND ")}
      ORDER BY a."viewCount" DESC, a."updatedAt" DESC LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }
  const terms = searchTerms(query);
  const tsq = o.match === "any" && terms.length
    ? Prisma.sql`to_tsquery('simple', ${terms.map((t) => `${t}:*`).join(" | ")})`
    : Prisma.sql`plainto_tsquery('simple', ${query})`;
  const likes = (o.match === "any" ? terms.filter((t) => t.length >= 3) : [query]).map((t) => `%${likeEscape(t)}%`);
  const likeCond = likes.length
    ? Prisma.join(likes.map((l) => Prisma.sql`(a."title" ILIKE ${l} OR a."summary" ILIKE ${l} OR a."body" ILIKE ${l} OR a."titleTh" ILIKE ${l} OR a."summaryTh" ILIKE ${l} OR a."bodyTh" ILIKE ${l})`), " OR ")
    : Prisma.sql`FALSE`;
  const titleHit = likes.length ? Prisma.join(likes.map((l) => Prisma.sql`(a."title" ILIKE ${l} OR coalesce(a."titleTh", '') ILIKE ${l})::int`), " + ") : Prisma.sql`0`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT a."id" FROM "KbArticle" a
     WHERE ${Prisma.join(conds, " AND ")} AND (${TSV} @@ ${tsq} OR ${likeCond})
     ORDER BY (${titleHit}) DESC, ts_rank(${TSV}, ${tsq}) DESC, a."viewCount" DESC, a."updatedAt" DESC
     LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

const listSelect = {
  id: true, number: true, title: true, summary: true, body: true, titleTh: true, summaryTh: true, bodyTh: true, type: true, visibility: true, status: true, tags: true,
  viewCount: true, helpfulYes: true, helpfulNo: true, publishedAt: true, updatedAt: true,
  category: { select: { id: true, name: true, nameTh: true, parent: { select: { name: true, nameTh: true } } } },
  author: { select: { displayName: true } },
} satisfies Prisma.KbArticleSelect;

type ListRow = Prisma.KbArticleGetPayload<{ select: typeof listSelect }>;
/** Title/snippet in the viewer's language (falls back to the other language). */
function present({ body, bodyTh, ...r }: ListRow, locale: Locale) {
  const title = pickLang(r.title, r.titleTh, locale);
  const summary = pickLang(r.summary, r.summaryTh, locale);
  return { ...r, title, snippet: summary || markdownToText(pickLang(body, bodyTh, locale), 200) };
}

async function hydrate(ids: string[], locale: Locale = DEFAULT_LOCALE) {
  if (!ids.length) return [];
  const rows = await prisma.kbArticle.findMany({ where: { id: { in: ids } }, select: listSelect });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)!).filter(Boolean).map((r) => present(r, locale));
}

export async function searchArticles(actor: Actor, q: string, o: KbSearchOptions = {}) {
  return hydrate(await searchArticleIds(actor, q, o), o.locale);
}

/** Deflection suggestions for the create-ticket form (published, visible to the actor). */
export async function suggestArticles(actor: Actor, text: string, categoryId?: string, locale: Locale = DEFAULT_LOCALE) {
  if (searchTerms(text).length === 0 && text.trim().length < 3) return [];
  const ids = await searchArticleIds(actor, text, { limit: 5, match: "any", categoryId: categoryId || undefined });
  return hydrate(ids, locale);
}

// ───────────────────────────── Read ─────────────────────────────

export async function getArticle(actor: Actor, number: string, opts: { countView?: boolean; management?: boolean } = {}) {
  const a = await prisma.kbArticle.findFirst({
    where: { AND: [kbReadWhere(actor, { management: opts.management }), { number }] },
    include: {
      category: { select: { id: true, name: true, nameTh: true, parent: { select: { id: true, name: true, nameTh: true } } } },
      author: { select: { displayName: true } }, updatedBy: { select: { displayName: true } },
      sourceTicket: { select: { id: true, number: true } },
    },
  });
  if (!a) throw new NotFoundError("Article not found.");
  if (opts.countView && a.status === "PUBLISHED") {
    await prisma.kbArticle.update({ where: { id: a.id }, data: { viewCount: { increment: 1 } } });
  }
  const mine = await prisma.kbFeedback.findUnique({ where: { articleId_userId: { articleId: a.id, userId: actor.id } }, select: { helpful: true } });
  // Source ticket is only revealed to someone who can see that ticket.
  const sourceVisible = a.sourceTicketId
    ? !!(await prisma.ticket.findFirst({ where: { AND: [ticketScopeWhere(actor), { id: a.sourceTicketId }] }, select: { id: true } }))
    : false;
  return {
    ...a, sourceTicket: sourceVisible ? a.sourceTicket : null, myFeedback: mine?.helpful ?? null,
    canEdit: canWriteKb(actor) && (a.status === "DRAFT" || canPublishKb(actor)),
    canPublish: canPublishKb(actor),
  };
}

/** Help Center landing data: categories with article counts + most viewed + FAQs. */
export async function helpCenterHome(actor: Actor, locale: Locale = DEFAULT_LOCALE) {
  const where = kbReadWhere(actor);
  const [popular, faqs, cats] = await Promise.all([
    prisma.kbArticle.findMany({ where, orderBy: [{ viewCount: "desc" }, { updatedAt: "desc" }], take: 6, select: listSelect }),
    prisma.kbArticle.findMany({ where: { ...where, type: "FAQ" }, orderBy: [{ helpfulYes: "desc" }, { viewCount: "desc" }], take: 8, select: listSelect }),
    prisma.kbArticle.groupBy({ by: ["categoryId"], where, _count: { _all: true } }),
  ]);
  const catIds = cats.map((c) => c.categoryId).filter((x): x is string => !!x);
  const catRows = await prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true, nameTh: true, parentId: true, parent: { select: { id: true, name: true, nameTh: true } } } });
  // Roll subcategories up to their main category.
  const mains = new Map<string, { id: string; name: string; count: number }>();
  for (const c of cats) {
    const row = catRows.find((r) => r.id === c.categoryId);
    if (!row) continue;
    const main = row.parent ? { id: row.parent.id, name: ln(row.parent, locale) } : { id: row.id, name: ln(row, locale) };
    const m = mains.get(main.id) ?? { ...main, count: 0 };
    m.count += c._count._all;
    mains.set(main.id, m);
  }
  const strip = (rows: typeof popular) => rows.map((r) => present(r, locale));
  return { popular: strip(popular), faqs: strip(faqs), categories: [...mains.values()].sort((a, b) => a.name.localeCompare(b.name, locale)) };
}

/** Published articles linked to (or in the same category as) a ticket. */
export async function relatedArticlesForTicket(actor: Actor, ticketId: string, locale: Locale = DEFAULT_LOCALE) {
  const t = await prisma.ticket.findFirst({ where: { AND: [ticketScopeWhere(actor), { id: ticketId }] }, select: { id: true, categoryId: true, subcategoryId: true } });
  if (!t) return [];
  const where = kbReadWhere(actor, { management: true }); // writers also see drafts linked to the ticket
  const linked = await prisma.kbArticle.findMany({ where: { AND: [where, { OR: [{ tickets: { some: { ticketId: t.id } } }, { sourceTicketId: t.id }] }] }, select: { id: true, number: true, title: true, titleTh: true, status: true }, take: 5 });
  const sameCat = await prisma.kbArticle.findMany({
    where: { AND: [kbReadWhere(actor), { id: { notIn: linked.map((l) => l.id) } }, { categoryId: { in: [t.subcategoryId, t.categoryId].filter((x): x is string => !!x) } }] },
    orderBy: [{ helpfulYes: "desc" }, { viewCount: "desc" }], take: 5, select: { id: true, number: true, title: true, titleTh: true, status: true },
  });
  const L = <T extends { title: string; titleTh: string | null }>(a: T) => ({ ...a, title: pickLang(a.title, a.titleTh, locale) });
  return [...linked.map((a) => ({ ...L(a), linked: true })), ...sameCat.map((a) => ({ ...L(a), linked: false }))];
}

/** Management list (/admin/kb). */
export async function listArticlesForAdmin(actor: Actor, f: { q?: string; status?: KbStatus; categoryId?: string; locale?: Locale }) {
  if (!canWriteKb(actor) && !canPublishKb(actor)) throw new AuthorizationError();
  if (f.q) return searchArticles(actor, f.q, { management: true, status: f.status, categoryId: f.categoryId, limit: 50, locale: f.locale });
  const rows = await prisma.kbArticle.findMany({
    where: { ...(f.status ? { status: f.status } : {}), ...(f.categoryId ? { OR: [{ categoryId: f.categoryId }, { category: { parentId: f.categoryId } }] } : {}) },
    orderBy: { updatedAt: "desc" }, take: 200, select: listSelect,
  });
  return rows.map((r) => present(r, f.locale ?? DEFAULT_LOCALE));
}

// ───────────────────────────── Write ─────────────────────────────

const optId = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().min(1).max(50).nullable());
export const articleSchema = z.object({
  title: z.string().trim().max(200).default(""),
  summary: z.string().trim().max(500).default(""),
  body: z.string().trim().max(50_000).default(""),
  titleTh: z.string().trim().max(200).default(""),
  summaryTh: z.string().trim().max(500).default(""),
  bodyTh: z.string().trim().max(50_000).default(""),
  type: z.enum(["FAQ", "TROUBLESHOOTING", "HOW_TO"]).default("FAQ"),
  visibility: z.enum(["EMPLOYEES", "SUPPORT_ONLY"]).default("EMPLOYEES"),
  categoryId: optId,
  tags: z.preprocess((v) => (typeof v === "string" ? v.split(",") : v ?? []), z.array(z.string().trim().max(40)).max(20))
    .transform((a) => [...new Set(a.filter(Boolean).map((t) => t.toLowerCase()))]),
  changeNote: z.string().trim().max(500).optional(),
}).superRefine((a, ctx) => {
  // One article may be English, Thai or both — but each language used needs a title and a body.
  const en = a.title || a.body, th = a.titleTh || a.bodyTh;
  if (!en && !th) ctx.addIssue({ code: "custom", path: ["title"], message: "validation.kbOneLanguage" });
  if (en && a.title.length < 5) ctx.addIssue({ code: "custom", path: ["title"], message: "validation.kbTitleMin" });
  if (en && a.body.length < 20) ctx.addIssue({ code: "custom", path: ["body"], message: "validation.kbBodyMin" });
  if (th && a.titleTh.length < 5) ctx.addIssue({ code: "custom", path: ["titleTh"], message: "validation.kbTitleMin" });
  if (th && a.bodyTh.length < 20) ctx.addIssue({ code: "custom", path: ["bodyTh"], message: "validation.kbBodyMin" });
});

function parseArticle(raw: unknown) {
  const p = articleSchema.safeParse(raw);
  if (!p.success) {
    const fe: Record<string, string> = {};
    for (const i of p.error.issues) fe[String(i.path[0])] ??= i.message;
    throw new ValidationError("Please correct the highlighted fields.", fe);
  }
  return p.data;
}

async function checkCategory(id: string | null) {
  if (id && !(await prisma.category.findFirst({ where: { id, deletedAt: null }, select: { id: true } }))) throw new ValidationError("Invalid category.", { categoryId: "Invalid category" });
}

export async function createArticle(actor: Actor, raw: unknown, opts: { sourceTicketId?: string } = {}) {
  if (!canWriteKb(actor)) throw new AuthorizationError("You cannot write knowledge articles.");
  await enforceRateLimit(`kb:create:${actor.id}`, 60, 60 * 60 * 1000);
  const input = parseArticle(raw);
  await checkCategory(input.categoryId);
  return transaction(async (tx) => {
    const number = await nextNumber(tx, "KB");
    const a = await tx.kbArticle.create({
      data: {
        number, title: input.title, summary: input.summary, body: input.body,
        titleTh: input.titleTh || null, summaryTh: input.summaryTh || null, bodyTh: input.bodyTh || null, type: input.type, visibility: input.visibility,
        categoryId: input.categoryId, tags: input.tags, authorId: actor.id, sourceTicketId: opts.sourceTicketId ?? null,
        ...(opts.sourceTicketId ? { tickets: { create: { ticketId: opts.sourceTicketId, linkedById: actor.id } } } : {}),
      },
    });
    await audit(tx, actor, { action: "KB_CREATED", entityType: "KbArticle", entityId: a.id, newValue: { number, title: a.title, sourceTicketId: opts.sourceTicketId ?? null } });
    return a;
  });
}

export async function updateArticle(actor: Actor, articleId: string, raw: unknown) {
  const a = await prisma.kbArticle.findUnique({ where: { id: articleId } });
  if (!a) throw new NotFoundError();
  if (!canWriteKb(actor)) throw new AuthorizationError("You cannot edit knowledge articles.");
  if (a.status !== "DRAFT" && !canPublishKb(actor)) throw new AuthorizationError("Only publishers can edit published or archived articles.");
  const input = parseArticle(raw);
  await checkCategory(input.categoryId);
  await transaction(async (tx) => {
    const moved = await tx.kbArticle.updateMany({
      where: { id: a.id, version: a.version },
      data: { title: input.title, summary: input.summary, body: input.body,
        titleTh: input.titleTh || null, summaryTh: input.summaryTh || null, bodyTh: input.bodyTh || null, type: input.type, visibility: input.visibility,
        categoryId: input.categoryId, tags: input.tags, updatedById: actor.id, version: { increment: 1 } },
    });
    if (moved.count !== 1) throw new ValidationError("The article was changed by someone else. Reload and try again.");
    await audit(tx, actor, {
      action: "KB_UPDATED", entityType: "KbArticle", entityId: a.id,
      oldValue: { version: a.version, title: a.title, visibility: a.visibility, bodyLength: a.body.length },
      newValue: { version: a.version + 1, title: input.title, titleTh: input.titleTh, visibility: input.visibility, bodyLength: input.body.length, bodyThLength: input.bodyTh.length, note: input.changeNote ?? null },
    });
  });
}

export async function setArticleStatus(actor: Actor, articleId: string, status: KbStatus) {
  if (!canPublishKb(actor)) throw new AuthorizationError("You cannot publish or archive articles.");
  const a = await prisma.kbArticle.findUnique({ where: { id: articleId } });
  if (!a) throw new NotFoundError();
  if (a.status === status) return;
  await transaction(async (tx) => {
    await tx.kbArticle.update({ where: { id: a.id }, data: { status, updatedById: actor.id, ...(status === "PUBLISHED" ? { publishedAt: new Date() } : {}) } });
    await audit(tx, actor, { action: `KB_${status}`, entityType: "KbArticle", entityId: a.id, oldValue: { status: a.status }, newValue: { status } });
  });
}

/** Drafts an article from a resolved/closed ticket the actor works on. */
/** Draft section headings in both languages (the draft is written in the author's UI language). */
const DRAFT = {
  en: { symptoms: "## Symptoms", solution: "## Solution", contact: "## When to contact IT", placeholder: "Describe the solution here.", contactText: "If these steps do not help, create a ticket and mention this article.", howTo: "How to fix:" },
  th: { symptoms: "## อาการ", solution: "## วิธีแก้ไข", contact: "## เมื่อใดควรติดต่อฝ่ายไอที", placeholder: "อธิบายวิธีแก้ไขที่นี่", contactText: "หากทำตามขั้นตอนแล้วยังไม่หาย ให้สร้างทิกเก็ตและอ้างถึงบทความนี้", howTo: "วิธีแก้ไข:" },
} as const;

export async function createArticleFromTicket(actor: Actor, ticketId: string, locale: Locale = DEFAULT_LOCALE) {
  if (!canWriteKb(actor)) throw new AuthorizationError("You cannot write knowledge articles.");
  const t = await prisma.ticket.findFirst({
    where: { AND: [ticketScopeWhere(actor), { id: ticketId }] },
    include: { status: true, subcategory: { select: { id: true } } },
  });
  if (!t) throw new NotFoundError("Ticket not found or you do not have access.");
  if (!can(actor, P.TICKET_READ_ALL) && !canWorkTicket(actor, t)) throw new AuthorizationError("You cannot create an article from this ticket.");
  if (!["RESOLVED", "CLOSED"].includes(t.status.kind)) throw new ValidationError("Only resolved or closed tickets can be turned into an article.");
  if (t.isConfidential) throw new ValidationError("Confidential tickets cannot be turned into an article.");
  const d = DRAFT[locale];
  const body = [
    d.symptoms, "", t.description.trim(), "",
    d.solution, "", (t.resolutionSummary ?? d.placeholder).trim(), "",
    d.contact, "", d.contactText,
  ].join("\n");
  const title = t.subject.length >= 5 ? t.subject : `${d.howTo} ${t.subject}`;
  const a = await createArticle(actor, {
    ...(locale === "th" ? { titleTh: title, bodyTh: body } : { title, body }), summary: "", type: "TROUBLESHOOTING",
    visibility: "SUPPORT_ONLY", categoryId: t.subcategoryId ?? t.categoryId, tags: [],
  }, { sourceTicketId: t.id });
  await prisma.ticketHistory.create({ data: { ticketId: t.id, actorId: actor.id, action: "KB_ARTICLE_CREATED", newValue: a.number } });
  return a;
}

export const feedbackSchema = z.object({
  helpful: z.preprocess((v) => v === true || v === "true" || v === "yes", z.boolean()),
  comment: z.string().trim().max(1000).optional(),
});

/** One vote per user per article (changeable); counters are recomputed from the rows. */
export async function giveFeedback(actor: Actor, articleId: string, raw: unknown, opts: { deflected?: boolean } = {}) {
  const a = await prisma.kbArticle.findFirst({ where: { AND: [kbReadWhere(actor), { id: articleId }] }, select: { id: true, number: true } });
  if (!a) throw new NotFoundError("Article not found.");
  await enforceRateLimit(`kb:feedback:${actor.id}`, 120, 60 * 60 * 1000);
  const { helpful, comment } = feedbackSchema.parse(raw);
  await transaction(async (tx) => {
    await tx.kbFeedback.upsert({
      where: { articleId_userId: { articleId: a.id, userId: actor.id } },
      create: { articleId: a.id, userId: actor.id, helpful, comment: comment || null },
      update: { helpful, comment: comment || null },
    });
    const [yes, no] = await Promise.all([
      tx.kbFeedback.count({ where: { articleId: a.id, helpful: true } }),
      tx.kbFeedback.count({ where: { articleId: a.id, helpful: false } }),
    ]);
    await tx.kbArticle.update({ where: { id: a.id }, data: { helpfulYes: yes, helpfulNo: no } });
    if (opts.deflected) await audit(tx, actor, { action: "KB_DEFLECTED", entityType: "KbArticle", entityId: a.id, newValue: { number: a.number } });
  });
}

export async function kbOptions(locale: Locale = DEFAULT_LOCALE) {
  const rows = await prisma.category.findMany({
    where: { parentId: null, isActive: true, deletedAt: null }, orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, nameTh: true, children: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, nameTh: true } } },
  });
  return rows.map((c) => ({ id: c.id, name: ln(c, locale), children: c.children.map((s) => ({ id: s.id, name: ln(s, locale) })) }));
}

export function requireKbManager(actor: Actor) {
  if (!canWriteKb(actor) && !canPublishKb(actor)) throw new AuthorizationError();
}
