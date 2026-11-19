import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "@/lib/csp";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("nonce-based CSP", () => {
  it("scripts require the nonce; no 'unsafe-inline' for scripts", () => {
    const csp = buildCsp("abc123==", { dev: false });
    const s = directive(csp, "script-src");
    expect(s).toContain("'nonce-abc123=='");
    expect(s).toContain("'strict-dynamic'");
    expect(s).not.toContain("'unsafe-inline'");
    expect(s).not.toContain("'unsafe-eval'");
  });
  it("dev adds eval (React refresh) and ws: only in dev", () => {
    expect(directive(buildCsp("n", { dev: true }), "script-src")).toContain("'unsafe-eval'");
    expect(directive(buildCsp("n", { dev: true }), "connect-src")).toContain("ws:");
    expect(directive(buildCsp("n", { dev: false }), "connect-src")).toBe("connect-src 'self'");
  });
  it("keeps framing, plugins and base-uri locked down", () => {
    const csp = buildCsp("n", { dev: false });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
  it("nonces are 128-bit, base64 and unique", () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(new Set(Array.from({ length: 50 }, generateNonce)).size).toBe(50);
  });
});
