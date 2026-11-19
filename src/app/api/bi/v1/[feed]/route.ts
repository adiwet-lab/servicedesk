import { NextResponse } from "next/server";
import { authenticateBi, BiError, FEEDS, runFeed, type Feed } from "@/server/integrations/bi";

export const dynamic = "force-dynamic";

/** GET /api/bi/v1/{feed}?$top=1000&$skip=0&modifiedSince=2026-01-01T00:00:00Z — Bearer sdbi_… token. */
export async function GET(req: Request, ctx: { params: Promise<{ feed: string }> }) {
  const { feed } = await ctx.params;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const token = await authenticateBi(req.headers.get("authorization"));
    if (!(FEEDS as readonly string[]).includes(feed)) throw new BiError(404, `Unknown feed. Available: ${FEEDS.join(", ")}`);
    const url = new URL(req.url);
    const r = await runFeed(feed as Feed, url.searchParams, token);
    const body: Record<string, unknown> = { value: r.value, "@odata.count": r.count };
    if (r.nextLink) body["@odata.nextLink"] = `${url.origin}${url.pathname}${r.nextLink}`;
    return NextResponse.json(body, { headers });
  } catch (e) {
    if (e instanceof BiError) return NextResponse.json({ error: e.message }, { status: e.status, headers: { ...headers, ...(e.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) } });
    console.error("[bi] feed error", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers });
  }
}
