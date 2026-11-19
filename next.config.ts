import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const https = (process.env.APP_URL ?? "").startsWith("https://");

const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; nonce-based CSP is a planned hardening step.
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Same-origin Socket.IO (ws/wss) for realtime chat & notifications.
  // 'self' covers same-origin ws:/wss: (Socket.IO) in CSP Level 3 browsers; headers are baked at build time,
  // so no deployment-specific URL here. Dev additionally allows ws: for hot reload.
  `connect-src 'self'${isProd ? "" : " ws: wss:"}`,
  "frame-ancestors 'none'",
  "form-action 'self' https://login.microsoftonline.com",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(https ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "60mb",
      // Server Actions reject cross-origin requests; list extra origins if behind a proxy.
      allowedOrigins: process.env.APP_URL ? [new URL(process.env.APP_URL).host] : undefined,
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
