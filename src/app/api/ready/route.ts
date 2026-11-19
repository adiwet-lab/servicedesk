import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

async function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

/** Readiness: database (and Redis when configured) reachable. Route traffic only when 200. */
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};
  try { await within(prisma.$queryRaw`SELECT 1`, 3000); checks.database = "ok"; } catch { checks.database = "fail"; }
  if (process.env.REDIS_URL) {
    try {
      const { createClient } = await import("redis");
      const c = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true, socket: { connectTimeout: 2000, reconnectStrategy: false } });
      c.on("error", () => {});
      await within(c.connect(), 2500);
      await within(c.ping(), 1000);
      await c.quit().catch(() => {});
      checks.redis = "ok";
    } catch { checks.redis = "fail"; }
  }
  const ok = Object.values(checks).every((v) => v === "ok");
  return Response.json({ status: ok ? "ready" : "not-ready", checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
