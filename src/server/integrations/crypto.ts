import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secrets at rest (webhook URLs, API keys): AES-256-GCM, format "v1.<iv>.<tag>.<ciphertext>" (base64url).
 * Key: INTEGRATIONS_KEY (base64, 32 bytes) or — if unset — HKDF-derived from AUTH_SECRET.
 */
function key(): Buffer {
  const explicit = process.env.INTEGRATIONS_KEY;
  if (explicit) {
    const k = Buffer.from(explicit, "base64");
    if (k.length !== 32) throw new Error("INTEGRATIONS_KEY must be 32 bytes, base64-encoded.");
    return k;
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Set INTEGRATIONS_KEY or AUTH_SECRET to store integration secrets.");
  return Buffer.from(hkdfSync("sha256", secret, "servicedesk-integrations", "secrets-v1", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(box: string): string {
  const [v, iv, tag, ct] = box.split(".");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unsupported secret format.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

/** Shows only scheme + host of a secret URL. */
export function maskUrl(url: string): string {
  try { const u = new URL(url); return `${u.protocol}//${u.host}/…`; } catch { return "••••"; }
}

// ───────────────────────────── API tokens ─────────────────────────────

export const TOKEN_PREFIX = "sdbi_";
export function generateApiToken(): string { return TOKEN_PREFIX + randomBytes(32).toString("base64url"); }
export function hashApiToken(token: string): string { return createHash("sha256").update(token, "utf8").digest("hex"); }
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex"); const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Stable pseudonymous key for a user in exports (HMAC; not reversible without the key). */
export function pseudonym(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return "u_" + createHmac("sha256", key()).update(`pseudonym:${userId}`).digest("base64url").slice(0, 16);
}
