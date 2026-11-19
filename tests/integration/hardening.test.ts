import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { RedisRateLimiter, type RedisEval } from "@/server/ratelimit";
import { createApiToken } from "@/server/integrations/bi";
import { GET as biGet } from "@/app/api/bi/v1/[feed]/route";

const hasRedis = spawnSync("which", ["redis-server"]).status === 0;
async function freePort() {
  return new Promise<number>((r) => { const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });
}
afterAll(() => prisma.$disconnect());

describe.skipIf(!hasRedis)("Redis rate limiter (real redis-server)", () => {
  let proc: ChildProcess;
  let url = "";
  beforeAll(async () => {
    const port = await freePort();
    proc = spawn("redis-server", ["--port", String(port), "--save", "", "--appendonly", "no"], { stdio: "ignore" });
    url = `redis://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) { if (spawnSync("redis-cli", ["-p", String(port), "ping"]).stdout?.toString().includes("PONG")) break; await new Promise((r) => setTimeout(r, 100)); }
  });
  afterAll(() => { proc?.kill(); });

  async function client() {
    const { createClient } = await import("redis");
    const c = createClient({ url });
    await c.connect();
    return c;
  }

  it("shares one window across limiter instances (= app replicas) and expires it", async () => {
    const c = await client();
    const prefix = `t${Date.now()}:`;
    const a = new RedisRateLimiter(async () => c as unknown as RedisEval, undefined, prefix);
    const b = new RedisRateLimiter(async () => c as unknown as RedisEval, undefined, prefix);
    expect([await a.hit("k", 2, 300), await b.hit("k", 2, 300), await a.hit("k", 2, 300)]).toEqual([true, true, false]);
    const ttl = Number(await c.pTTL(`${prefix}k`));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);
    await new Promise((r) => setTimeout(r, 350));
    expect(await a.hit("k", 2, 300)).toBe(true);
    await c.quit();
  });

  it("concurrent hits never exceed the limit", async () => {
    const c = await client();
    const l = new RedisRateLimiter(async () => c as unknown as RedisEval, undefined, `c${Date.now()}:`);
    const results = await Promise.all(Array.from({ length: 50 }, () => l.hit("burst", 10, 10_000)));
    expect(results.filter(Boolean)).toHaveLength(10);
    await c.quit();
  });
});

describe("Power BI per-IP failure throttle", () => {
  it("repeated bad tokens from one address get 429; other addresses and valid tokens are unaffected", async () => {
    const call = (ip: string, token: string) => biGet(new Request("https://sd.test/api/bi/v1/teams", { headers: { Authorization: `Bearer ${token}`, "x-sd-remote-addr": ip } }), { params: Promise.resolve({ feed: "teams" }) });
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await call(ip, "sdbi_bad")).status);
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
    expect(codes.slice(20)).toEqual([429, 429]);
    expect((await call("192.0.2.1", "sdbi_bad")).status).toBe(401);
    const admin = (await loadActor(prisma, (await prisma.user.findFirstOrThrow({ where: { email: "sys.admin@contoso.example" } })).id))!;
    const { token } = await createApiToken(admin, { name: "throttle test" });
    expect((await call(ip, token)).status).toBe(200);
  });
});
