import { RateLimitError } from "./authz/errors";

/**
 * Fixed-window rate limiter. In-memory implementation suitable for a single
 * instance; swap for a Redis-backed implementation when scaling out.
 */
export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): boolean;
}

class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  hit(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      if (this.buckets.size > 50_000) this.sweep(now);
      return true;
    }
    b.count++;
    return b.count <= limit;
  }
  private sweep(now: number) {
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
  }
}

const g = globalThis as unknown as { __rl?: RateLimiter };
export const rateLimiter: RateLimiter = (g.__rl ??= new MemoryRateLimiter());

export function enforceRateLimit(key: string, limit: number, windowMs: number) {
  if (!rateLimiter.hit(key, limit, windowMs)) throw new RateLimitError();
}
