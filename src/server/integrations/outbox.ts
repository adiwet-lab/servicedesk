import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { acquireLease, releaseLease } from "@/server/jobs/lease";
import { HttpError } from "./http";
import { deliverTeams, PermanentError } from "./teams";

const LEASE_KEY = "jobs.outbox.lease";
export const MAX_ATTEMPTS = 6;
/** Exponential backoff: 1, 2, 4, 8, 16 minutes (or the server's Retry-After, capped at 1h). */
export function backoffMs(attempt: number, retryAfterMs: number | null) {
  if (retryAfterMs != null) return Math.min(Math.max(retryAfterMs, 1000), 3_600_000);
  return Math.min(2 ** Math.max(0, attempt - 1) * 60_000, 3_600_000);
}
/** 4xx (except 408/429) won't succeed on retry. */
export function isPermanent(e: unknown) {
  if (e instanceof PermanentError) return true;
  if (e instanceof HttpError) return e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
  return e instanceof Error && /allow-list|Only https|IP addresses|credentials|Unsupported secret|Invalid URL/.test(e.message);
}

const deliverers: Record<string, (target: string, payload: unknown) => Promise<void>> = { teams: deliverTeams };

export interface OutboxResult { skipped?: boolean; sent: number; failed: number; dead: number }

/** Delivers due outbox rows (lease-protected; safe with several app instances). */
export async function processOutbox(db: PrismaClient = prisma, opts: { limit?: number; now?: Date } = {}): Promise<OutboxResult> {
  const holder = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const r: OutboxResult = { sent: 0, failed: 0, dead: 0 };
  if (!(await acquireLease(db, LEASE_KEY, holder, 2 * 60_000))) return { ...r, skipped: true };
  try {
    const now = opts.now ?? new Date();
    const due = await db.integrationOutbox.findMany({
      where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } }, orderBy: { createdAt: "asc" }, take: opts.limit ?? 50,
    });
    for (const row of due) {
      const attempt = row.attempts + 1;
      try {
        const fn = deliverers[row.channel];
        if (!fn) throw new PermanentError(`Unknown channel ${row.channel}`);
        await fn(row.target, row.payload);
        await db.integrationOutbox.update({ where: { id: row.id }, data: { status: "SENT", attempts: attempt, sentAt: new Date(), lastError: null } });
        r.sent++;
      } catch (e) {
        const msg = (e instanceof HttpError && e.status ? `${e.message}${e.body ? `: ${e.body.slice(0, 200)}` : ""}` : (e as Error).message).slice(0, 500);
        const dead = isPermanent(e) || attempt >= MAX_ATTEMPTS;
        await db.integrationOutbox.update({
          where: { id: row.id },
          data: { status: dead ? "DEAD" : "FAILED", attempts: attempt, lastError: msg,
            nextAttemptAt: new Date(now.getTime() + backoffMs(attempt, e instanceof HttpError ? e.retryAfterMs : null)) },
        });
        if (dead) r.dead++; else r.failed++;
      }
    }
    return r;
  } finally {
    await releaseLease(db, LEASE_KEY, holder).catch(() => {});
  }
}
