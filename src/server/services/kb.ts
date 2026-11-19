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

const TSV = Prisma.sql`to_tsvector('simple', coalesce(a."title", '') || ' ' || coalesce(a."summary", '') || ' ' || coalesce(a."body", ''))`;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
/** Word tokens (letters/digits in any script) for OR-queries; capped to keep the query cheap. */
export function searchTerms(q: string, max = 12): string[] {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return [...new Set(words)].slice(0, max);
}

export interface KbSearchOptions { categoryId?: string; type?: keyof typeof KB_TYPE_LABEL; limit?: number; management?: boolean; status?: KbStatus; match?: "all" | "any" }

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
    ? Prisma.join(likes.map((l) => Prisma.sql`(a."title" ILIKE ${l} OR a."summary" ILIKE ${l} OR a."body" ILIKE ${l})`), " OR ")
    : Prisma.sql`FALSE`;
  const titleHit = likes.length ? Prisma.join(likes.map((l) => Prisma.sql`(a."title" ILIKE ${l})::int`), " + ") : Prisma.sql`0`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT a."id" FROM "KbArticle" a
     WHERE ${Prisma.join(conds, " AND ")} AND (${TSV} @@ ${tsq} OR ${likeCond})
     ORDER BY (${titleHit}) DESC, ts_rank(${TSV}, ${tsq}) DESC, a."viewCount" DESC, a."updatedAt" DESC
     LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

const listSelect = {
  id: true, number: true, title: true, summary: true, body: true, type: true, visibility: true, status: true, tags: true,
  viewCount: true, helpfulYes: true, helpfulNo: true, publishedAt: true, updatedAt: true,
  category: { select: { id: true, name: true, parent: { select: { name: true } } } },
  author: { select: { displayName: true } },
} satisfies Prisma.KbArticleSelect;

async function hydrate(ids: string[]) {
  if (!ids.length) return [];
  const rows = await prisma.kbArticle.findMany({ where: { id: { in: ids } }, select: listSelect });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)!).filter(Boolean).map(({ body, ...r }) => ({ ...r, snippet: r.summary || markdownToText(body, 200) }));
}

export async function searchArticles(actor: Actor, q: string, o: KbSearchOptions = {}) {
  return hydrate(await searchArticleIds(actor, q, o));
}

/** Deflection suggestions for the create-ticket form (published, visible to the actor). */
export async function suggestArticles(actor: Actor, text: string, categoryId?: string) {
  if (searchTerms(text).length === 0 && text.trim().length < 3) return [];
  const ids = await searchArticleIds(actor, text, { limit: 5, match: "any", categoryId: categoryId || undefined });
  return hydrate(ids);
}

// ───────────────────────────── Read ─────────────────────────────

export async function getArticle(actor: Actor, number: string, opts: { countView?: boolean; management?: boolean } = {}) {
  const a = await prisma.kbArticle.findFirst({
    where: { AND: [kbReadWhere(actor, { management: opts.management }), { number }] },
    include: {
      category: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } },
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
export async function helpCenterHome(actor: Actor) {
  const where = kbReadWhere(actor);
  const [popular, faqs, cats] = await Promise.all([
    prisma.kbArticle.findMany({ where, orderBy: [{ viewCount: "desc" }, { updatedAt: "desc" }], take: 6, select: listSelect }),
    prisma.kbArticle.findMany({ where: { ...where, type: "FAQ" }, orderBy: [{ helpfulYes: "desc" }, { viewCount: "desc" }], take: 8, select: listSelect }),
    prisma.kbArticle.groupBy({ by: ["categoryId"], where, _count: { _all: true } }),
  ]);
  const catIds = cats.map((c) => c.categoryId).filter((x): x is string => !!x);
  const catRows = await prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true, parentId: true, parent: { select: { id: true, name: true } } } });
  // Roll subcategories up to their main category.
  const mains = new Map<string, { id: string; name: string; count: number }>();
  for (const c of cats) {
    const row = catRows.find((r) => r.id === c.categoryId);
    if (!row) continue;
    const main = row.parent ?? { id: row.id, name: row.name };
    const m = mains.get(main.id) ?? { ...main, count: 0 };
    m.count += c._count._all;
    mains.set(main.id, m);
  }
  const strip = (rows: typeof popular) => rows.map(({ body, ...r }) => ({ ...r, snippet: r.summary || markdownToText(body, 200) }));
  return { popular: strip(popular), faqs: strip(faqs), categories: [...mains.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Published articles linked to (or in the same category as) a ticket. */
export async function relatedArticlesForTicket(actor: Actor, ticketId: string) {
  const t = await prisma.ticket.findFirst({ where: { AND: [ticketScopeWhere(actor), { id: ticketId }] }, select: { id: true, categoryId: true, subcategoryId: true } });
  if (!t) return [];
  const where = kbReadWhere(actor, { management: true }); // writers also see drafts linked to the ticket
  const linked = await prisma.kbArticle.findMany({ where: { AND: [where, { OR: [{ tickets: { some: { ticketId: t.id } } }, { sourceTicketId: t.id }] }] }, select: { id: true, number: true, title: true, status: true }, take: 5 });
  const sameCat = await prisma.kbArticle.findMany({
    where: { AND: [kbReadWhere(actor), { id: { notIn: linked.map((l) => l.id) } }, { categoryId: { in: [t.subcategoryId, t.categoryId].filter((x): x is string => !!x) } }] },
    orderBy: [{ helpfulYes: "desc" }, { viewCount: "desc" }], take: 5, select: { id: true, number: true, title: true, status: true },
  });
  return [...linked.map((a) => ({ ...a, linked: true })), ...sameCat.map((a) => ({ ...a, linked: false }))];
}

/** Management list (/admin/kb). */
export async function listArticlesForAdmin(actor: Actor, f: { q?: string; status?: KbStatus; categoryId?: string }) {
  if (!canWriteKb(actor) && !canPublishKb(actor)) throw new AuthorizationError();
  if (f.q) return searchArticles(actor, f.q, { management: true, status: f.status, categoryId: f.categoryId, limit: 50 });
  const rows = await prisma.kbArticle.findMany({
    where: { ...(f.status ? { status: f.status } : {}), ...(f.categoryId ? { OR: [{ categoryId: f.categoryId }, { category: { parentId: f.categoryId } }] } : {}) },
    orderBy: { updatedAt: "desc" }, take: 200, select: listSelect,
  });
  return rows.map(({ body, ...r }) => ({ ...r, snippet: r.summary || markdownToText(body, 200) }));
}

// ───────────────────────────── Write ─────────────────────────────

const optId = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().min(1).max(50).nullable());
export const articleSchema = z.object({
  title: z.string().trim().min(5, "Title must be at least 5 characters").max(200),
  summary: z.string().trim().max(500).default(""),
  body: z.string().trim().min(20, "Article body must be at least 20 characters").max(50_000),
  type: z.enum(["FAQ", "TROUBLESHOOTING", "HOW_TO"]).default("FAQ"),
  visibility: z.enum(["EMPLOYEES", "SUPPORT_ONLY"]).default("EMPLOYEES"),
  categoryId: optId,
  tags: z.preprocess((v) => (typeof v === "string" ? v.split(",") : v ?? []), z.array(z.string().trim().max(40)).max(20))
    .transform((a) => [...new Set(a.filter(Boolean).map((t) => t.toLowerCase()))]),
  changeNote: z.string().trim().max(500).optional(),
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
  enforceRateLimit(`kb:create:${actor.id}`, 60, 60 * 60 * 1000);
  const input = parseArticle(raw);
  await checkCategory(input.categoryId);
  return transaction(async (tx) => {
    const number = await nextNumber(tx, "KB");
    const a = await tx.kbArticle.create({
      data: {
        number, title: input.title, summary: input.summary, body: input.body, type: input.type, visibility: input.visibility,
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
      data: { title: input.title, summary: input.summary, body: input.body, type: input.type, visibility: input.visibility,
        categoryId: input.categoryId, tags: input.tags, updatedById: actor.id, version: { increment: 1 } },
    });
    if (moved.count !== 1) throw new ValidationError("The article was changed by someone else. Reload and try again.");
    await audit(tx, actor, {
      action: "KB_UPDATED", entityType: "KbArticle", entityId: a.id,
      oldValue: { version: a.version, title: a.title, visibility: a.visibility, bodyLength: a.body.length },
      newValue: { version: a.version + 1, title: input.title, visibility: input.visibility, bodyLength: input.body.length, note: input.changeNote ?? null },
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
export async function createArticleFromTicket(actor: Actor, ticketId: string) {
  if (!canWriteKb(actor)) throw new AuthorizationError("You cannot write knowledge articles.");
  const t = await prisma.ticket.findFirst({
    where: { AND: [ticketScopeWhere(actor), { id: ticketId }] },
    include: { status: true, subcategory: { select: { id: true } } },
  });
  if (!t) throw new NotFoundError("Ticket not found or you do not have access.");
  if (!can(actor, P.TICKET_READ_ALL) && !canWorkTicket(actor, t)) throw new AuthorizationError("You cannot create an article from this ticket.");
  if (!["RESOLVED", "CLOSED"].includes(t.status.kind)) throw new ValidationError("Only resolved or closed tickets can be turned into an article.");
  if (t.isConfidential) throw new ValidationError("Confidential tickets cannot be turned into an article.");
  const body = [
    "## Symptoms", "", t.description.trim(), "",
    "## Solution", "", (t.resolutionSummary ?? "Describe the solution here.").trim(), "",
    "## When to contact IT", "", "If these steps do not help, create a ticket and mention this article.",
  ].join("\n");
  const a = await createArticle(actor, {
    title: t.subject.length >= 5 ? t.subject : `How to fix: ${t.subject}`, summary: "", body, type: "TROUBLESHOOTING",
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
  enforceRateLimit(`kb:feedback:${actor.id}`, 120, 60 * 60 * 1000);
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

export async function kbOptions() {
  return prisma.category.findMany({
    where: { parentId: null, isActive: true, deletedAt: null }, orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, children: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } } },
  });
}

export function requireKbManager(actor: Actor) {
  if (!canWriteKb(actor) && !canPublishKb(actor)) throw new AuthorizationError();
}
