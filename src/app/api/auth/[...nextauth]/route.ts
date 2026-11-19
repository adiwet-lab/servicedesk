import { handlers } from "@/server/auth/auth";
import { rateLimiter } from "@/server/ratelimit";
import { clientIp } from "@/server/net";

/** Per-IP throttle on sign-in endpoints (callbacks, credential/dev sign-in, CSRF, session). */
async function limited(req: Request) {
  const ip = clientIp(req.headers) ?? "unknown";
  return !(await rateLimiter.hit(`auth:ip:${ip}`, 120, 60_000));
}
const tooMany = () => new Response("Too many sign-in requests. Please wait a minute.", { status: 429, headers: { "Retry-After": "60" } });

export async function GET(req: Parameters<typeof handlers.GET>[0]) {
  return (await limited(req)) ? tooMany() : handlers.GET(req);
}
export async function POST(req: Parameters<typeof handlers.POST>[0]) {
  return (await limited(req)) ? tooMany() : handlers.POST(req);
}
