import { RateLimitError } from "./authz/errors";

/**
 * Fixed-window rate limiter. Redis-backed when REDIS_URL is set (shared by all app
 * instances — atomic INCR + PEXPIRE in one Lua script), otherwise in-memory.
 * If Redis is unreachable the limiter degrades to the in-memory window of that
 * instance (logged, throttled) rather than failing requests or disabling limits.
 */
export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<boolean>;
}

export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  async hit(key: string, limit: number, windowMs: number) {
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

export const WINDOW_SCRIPT = "local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return c";

/** Minimal client surface (lets tests inject a fake). */
export interface RedisEval { eval(script: string, opts: { keys: string[]; arguments: string[] }): Promise<unknown> }

export class RedisRateLimiter implements RateLimiter {
  private lastLog = 0;
  constructor(private client: () => Promise<RedisEval>, private fallback = new MemoryRateLimiter(), private prefix = "rl:") {}
  async hit(key: string, limit: number, windowMs: number) {
    try {
      const c = await this.client();
      const count = Number(await c.eval(WINDOW_SCRIPT, { keys: [this.prefix + key], arguments: [String(windowMs)] }));
      return count <= limit;
    } catch (e) {
      if (Date.now() - this.lastLog > 60_000) { this.lastLog = Date.now(); console.error("[ratelimit] Redis unavailable, using in-memory window:", (e as Error).message); }
      return this.fallback.hit(key, limit, windowMs);
    }
  }
}

function redisClientFactory(url: string) {
  let p: Promise<RedisEval> | null = null;
  return () => {
    p ??= (async () => {
      const { createClient } = await import("redis");
      const c = createClient({ url, disableOfflineQueue: true, socket: { connectTimeout: 2000, reconnectStrategy: (n) => Math.min(n * 200, 5000) } });
      c.on("error", () => {}); // surfaced via failed commands
      await c.connect();
      return c as unknown as RedisEval;
    })().catch((e) => { p = null; throw e; });
    return p;
  };
}

const g = globalThis as unknown as { __rl?: RateLimiter };
export const rateLimiter: RateLimiter = (g.__rl ??= process.env.REDIS_URL ? new RedisRateLimiter(redisClientFactory(process.env.REDIS_URL)) : new MemoryRateLimiter());

export async function enforceRateLimit(key: string, limit: number, windowMs: number) {
  if (!(await rateLimiter.hit(key, limit, windowMs))) throw new RateLimitError();
}
