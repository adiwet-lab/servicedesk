export const dynamic = "force-dynamic";

/** Liveness: the process is up and serving. Dependencies are checked by /api/ready. */
export async function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
