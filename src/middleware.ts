import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, generateNonce } from "@/lib/csp";

/**
 * Edge middleware:
 * 1. Per-request nonce-based Content-Security-Policy for every page and app API route.
 * 2. Session gate: bounce requests without a session cookie to /login.
 * Real authentication/authorization (session validity, account status, tenant,
 * permissions, data scope) happens server-side in getActor() and the services.
 */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];
const PUBLIC_PATHS = ["/login"];

export function middleware(req: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== "production" });
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const hasSession = SESSION_COOKIES.some((c) => req.cookies.has(c));
  if (!hasSession && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    const res = NextResponse.redirect(url);
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  // Next.js reads the nonce from the request CSP header and applies it to its inline scripts.
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Attachments (own sandbox CSP), auth callbacks, health and Power BI feeds are excluded.
  matcher: ["/((?!api/auth|api/health|api/ready|api/bi/|api/attachments|_next/static|_next/image|favicon.ico).*)"],
};
