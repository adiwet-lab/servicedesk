import { prisma } from "@/server/db";
import { getActor } from "@/server/auth/get-actor";
import { AuthorizationError, NotFoundError, RateLimitError } from "@/server/authz/errors";
import { enforceRateLimit } from "@/server/ratelimit";
import { parseAnalyticsFilters } from "@/server/services/analytics";
import { runReport } from "@/server/services/reports";
import { audit } from "@/server/services/audit";
import { toCsv } from "@/server/domain/analytics";

export const dynamic = "force-dynamic";

/** CSV export of a report within the caller's data scope (report.export). Audited. */
export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const { type } = await params;
  const url = new URL(req.url);
  const filters = parseAnalyticsFilters(Object.fromEntries(url.searchParams.entries()));
  try {
    await enforceRateLimit(`report:${actor.id}`, 10, 60_000);
    const r = await runReport(actor, type, filters);
    await prisma.$transaction((tx) => audit(tx, actor, {
      action: "REPORT_EXPORTED", entityType: "Report", entityId: type, newValue: { type, filters, rows: r.rows.length, truncated: r.truncated },
    }));
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(toCsv(r.headers, r.rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="servicedesk-${type}-${stamp}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(r.truncated ? { "X-Report-Truncated": "true" } : {}),
      },
    });
  } catch (e) {
    if (e instanceof AuthorizationError) return new Response("Forbidden", { status: 403 });
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (e instanceof RateLimitError) return new Response("Too many requests", { status: 429 });
    throw e;
  }
}
