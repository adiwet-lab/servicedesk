import { isIP } from "node:net";

/**
 * Outbound-URL policy (SSRF guard). Integration targets must be https, on the default
 * port, without credentials, a DNS name (never an IP literal), and on an allow-listed
 * host. INTEGRATIONS_ALLOWED_HOSTS adds exact hosts or ".suffix" entries (e.g. an
 * internal asset system). Loopback http is accepted only when INTEGRATIONS_ALLOW_LOOPBACK=true
 * outside production — used for local mock servers in tests.
 */
export const TEAMS_WEBHOOK_HOSTS = [".webhook.office.com", ".logic.azure.com", ".environment.api.powerplatform.com", ".powerplatform.com"];

export function loopbackAllowed() {
  return process.env.INTEGRATIONS_ALLOW_LOOPBACK === "true" && process.env.NODE_ENV !== "production";
}

function hostMatches(host: string, rule: string): boolean {
  const r = rule.trim().toLowerCase();
  if (!r) return false;
  if (r.startsWith(".")) return host.endsWith(r) && host.length > r.length;
  return host === r;
}

export function extraAllowedHosts(): string[] {
  return (process.env.INTEGRATIONS_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/** Returns the parsed URL or throws with a user-presentable reason. */
export function assertOutboundUrl(raw: string, allow: string[]): URL {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error("Invalid URL."); }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  if (loopback && loopbackAllowed() && (u.protocol === "http:" || u.protocol === "https:")) return u;
  if (u.protocol !== "https:") throw new Error("Only https URLs are allowed.");
  if (u.username || u.password) throw new Error("URLs must not contain credentials.");
  if (u.port && u.port !== "443") throw new Error("Only the default https port is allowed.");
  if (isIP(host.replace(/^\[|\]$/g, "")) || /^\d+$/.test(host) || /^0x/i.test(host)) throw new Error("IP addresses are not allowed — use a host name.");
  if (!host.includes(".")) throw new Error("A fully-qualified host name is required.");
  const rules = [...allow, ...extraAllowedHosts()];
  if (!rules.some((r) => hostMatches(host, r))) throw new Error(`Host "${host}" is not on the integration allow-list.`);
  return u;
}
