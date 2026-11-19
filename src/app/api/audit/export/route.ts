import { getActor } from "@/server/auth/get-actor";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";
import { enforceRateLimit } from "@/server/ratelimit";
import { startAuditExport } from "@/server/services/admin/audit-export";

export const dynamic = "force-dynamic";

/** GET /api/audit/export?format=csv|ndjson&from=YYYY-MM-DD&to=YYYY-MM-DD&action=&entity=&actor=&q= */
export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "ndjson" ? "ndjson" : "csv";
  const pick = (k: string) => sp.get(k)?.slice(0, 200) || undefined;
  try {
    await enforceRateLimit(`audit-export:${actor.id}`, 5, 60_000);
    const { chunks, filter } = await startAuditExport(actor, { from: pick("from"), to: pick("to"), action: pick("action"), entity: pick("entity"), actor: pick("actor"), q: pick("q") }, format);
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        const { value, done } = await chunks.next();
        if (done) ctrl.close(); else ctrl.enqueue(enc.encode(value));
      },
      async cancel() { await chunks.return(undefined); },
    });
    return new Response(body, {
      headers: {
        "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-${filter.from}_${filter.to}.${format === "csv" ? "csv" : "ndjson"}"`,
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AuthorizationError) return new Response("Forbidden", { status: 403 });
    if (e instanceof ValidationError) return new Response(e.message, { status: 400 });
    if ((e as Error).name === "RateLimitError") return new Response("Too many exports", { status: 429 });
    throw e;
  }
}
