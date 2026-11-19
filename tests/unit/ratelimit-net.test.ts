import { describe, expect, it } from "vitest";
import { clientIp, REMOTE_ADDR_HEADER } from "@/server/net";
import { MemoryRateLimiter, RedisRateLimiter, WINDOW_SCRIPT, type RedisEval } from "@/server/ratelimit";

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });

describe("clientIp", () => {
  it("uses the server-stamped peer address and ignores X-Forwarded-For by default", () => {
    expect(clientIp(h({ [REMOTE_ADDR_HEADER]: "10.0.0.9", "x-forwarded-for": "1.2.3.4" }), 0)).toBe("10.0.0.9");
  });
  it("with trusted proxies, takes the entry the outermost trusted proxy appended (not the spoofable first one)", () => {
    const spoofed = h({ [REMOTE_ADDR_HEADER]: "10.0.0.2", "x-forwarded-for": "6.6.6.6, 203.0.113.7" });
    expect(clientIp(spoofed, 1)).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.1.0.4" }), 2)).toBe("203.0.113.7");
  });
  it("falls back to the peer when the chain is shorter than the trusted hops", () => {
    expect(clientIp(h({ [REMOTE_ADDR_HEADER]: "10.0.0.2", "x-forwarded-for": "" }), 1)).toBe("10.0.0.2");
    expect(clientIp(h({}), 0)).toBeNull();
  });
});

describe("rate limiters", () => {
  it("memory: fixed window per key", async () => {
    const m = new MemoryRateLimiter();
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await m.hit("k", 3, 60_000));
    expect(r).toEqual([true, true, true, false]);
    expect(await m.hit("other", 3, 60_000)).toBe(true);
    expect(await m.hit("w", 1, 1)).toBe(true);
    await new Promise((x) => setTimeout(x, 5));
    expect(await m.hit("w", 1, 1)).toBe(true); // window expired
  });
  it("redis: uses one atomic script with a prefixed key and the window in ms", async () => {
    const calls: { script: string; keys: string[]; args: string[] }[] = [];
    let n = 0;
    const fake: RedisEval = { eval: async (script, o) => { calls.push({ script, keys: o.keys, args: o.arguments }); return ++n; } };
    const r = new RedisRateLimiter(async () => fake);
    expect(await r.hit("a", 2, 5000)).toBe(true);
    expect(await r.hit("a", 2, 5000)).toBe(true);
    expect(await r.hit("a", 2, 5000)).toBe(false);
    expect(calls[0]).toEqual({ script: WINDOW_SCRIPT, keys: ["rl:a"], args: ["5000"] });
  });
  it("redis: degrades to the in-memory window when Redis is down (limits still apply)", async () => {
    const r = new RedisRateLimiter(async () => { throw new Error("ECONNREFUSED"); });
    const out = [];
    for (let i = 0; i < 3; i++) out.push(await r.hit("b", 2, 60_000));
    expect(out).toEqual([true, true, false]);
  });
});
