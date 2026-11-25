import { getActor } from "@/server/auth/get-actor";
import { AuthorizationError } from "@/server/authz/errors";
import { exportAccessReviewCsv } from "@/server/services/admin/access-review";
import { enforceRateLimit } from "@/server/ratelimit";
import { currentLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  try {
    await enforceRateLimit(`access-review:${actor.id}`, 10, 60_000);
    const csv = await exportAccessReviewCsv(actor, await currentLocale());
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, /* toCsv already starts with a BOM */ { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="access-review-${day}.csv"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AuthorizationError) return new Response("Forbidden", { status: 403 });
    if ((e as Error).name === "RateLimitError") return new Response("Too many exports", { status: 429 });
    throw e;
  }
}
