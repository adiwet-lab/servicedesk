/**
 * Content-Security-Policy builder (pure; runs in the Edge middleware).
 * Scripts: per-request nonce + 'strict-dynamic' (no 'unsafe-inline'); Next.js stamps the
 * nonce on its own inline bootstrap scripts when the CSP is passed as a request header.
 * Styles keep 'unsafe-inline' (Tailwind/Radix inline style attributes; not script-capable).
 */
export function buildCsp(nonce: string, opts: { dev: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Same-origin Socket.IO; dev additionally allows ws: for hot reload.
    `connect-src 'self'${opts.dev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "form-action 'self' https://login.microsoftonline.com",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** 128-bit random nonce, base64 (Web Crypto — available in Edge and Node). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
