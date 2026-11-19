/**
 * Client IP resolution.
 * The custom server (server.ts) overwrites `x-sd-remote-addr` with the TCP peer address, so it
 * can't be spoofed. X-Forwarded-For is only honoured for TRUST_PROXY_HOPS trusted proxies
 * (e.g. 1 behind Front Door / App Gateway / Container Apps ingress): the client is the entry that
 * the outermost trusted proxy appended — never the left-most, client-controlled entry.
 */
export const REMOTE_ADDR_HEADER = "x-sd-remote-addr";

export function trustedHops(): number {
  const n = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  return Number.isInteger(n) && n > 0 && n < 10 ? n : 0;
}

export function clientIp(h: Pick<Headers, "get">, hops = trustedHops()): string | null {
  const peer = h.get(REMOTE_ADDR_HEADER)?.trim() || null;
  if (hops > 0) {
    const chain = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    // With N trusted proxies the last N-1 entries were added by inner proxies; the entry before them is the client.
    const idx = chain.length - hops;
    if (idx >= 0 && chain[idx]) return chain[idx]!;
  }
  return peer;
}
