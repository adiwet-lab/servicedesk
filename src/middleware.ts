import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge gate: bounce requests without a session cookie to /login.
 * Real authentication/authorization (session validity, account status, tenant,
 * permissions, data scope) happens server-side in getActor() and the services.
 */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function middleware(req: NextRequest) {
  const hasSession = SESSION_COOKIES.some((c) => req.cookies.has(c));
  if (!hasSession) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|api/health|api/bi/|login|_next/static|_next/image|favicon.ico).*)"],
};
