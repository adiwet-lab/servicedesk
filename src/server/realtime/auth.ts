import { decode } from "next-auth/jwt";
import type { PrismaClient } from "@prisma/client";
import { loadActor } from "@/server/auth/load-actor";
import type { Actor } from "@/server/authz/actor";

const COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"];

export function parseCookies(header: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      map.set(k, decodeURIComponent(v));
    } catch {
      map.set(k, v);
    }
  }
  return map;
}

/** Reads the Auth.js session cookie (supports chunked cookies `.0`, `.1`, …). */
function sessionToken(cookies: Map<string, string>): { name: string; value: string } | null {
  for (const name of COOKIE_NAMES) {
    if (cookies.has(name)) return { name, value: cookies.get(name)! };
    const chunks: string[] = [];
    for (let i = 0; cookies.has(`${name}.${i}`); i++) chunks.push(cookies.get(`${name}.${i}`)!);
    if (chunks.length) return { name, value: chunks.join("") };
  }
  return null;
}

export interface SocketIdentity {
  userId: string;
  sessionVersion?: number;
}

/** Decrypts and verifies the session JWT. Returns null for missing/forged/expired tokens. */
export async function identityFromCookie(cookieHeader: string | undefined, secret: string): Promise<SocketIdentity | null> {
  const tok = sessionToken(parseCookies(cookieHeader));
  if (!tok || !secret) return null;
  try {
    const payload = await decode({ token: tok.value, secret, salt: tok.name });
    if (!payload || typeof payload.uid !== "string") return null;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return { userId: payload.uid, sessionVersion: typeof payload.sv === "number" ? payload.sv : undefined };
  } catch {
    return null;
  }
}

/** Full actor (status, tenant, expiry, sessionVersion all re-checked) or null. */
export async function actorForIdentity(db: PrismaClient, id: SocketIdentity, ip?: string | null): Promise<Actor | null> {
  return loadActor(db, id.userId, { sessionVersion: id.sessionVersion, ip });
}
