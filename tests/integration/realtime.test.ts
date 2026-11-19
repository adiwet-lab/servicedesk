import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket } from "socket.io-client";
import { encode } from "next-auth/jwt";
import type { Server } from "socket.io";
import { prisma } from "@/server/db";
import { loadActor } from "@/server/auth/load-actor";
import { createRealtimeServer } from "@/server/realtime/socket-server";
import { createTicket } from "@/server/services/tickets";
import { postMessage } from "@/server/services/messages";

const SECRET = "test-realtime-secret-0123456789abcdef0123456789";
const COOKIE = "authjs.session-token";
let http: HttpServer;
let io: Server;
let url = "";
const sockets: Socket[] = [];

async function userId(email: string) {
  return (await prisma.user.findFirstOrThrow({ where: { email } })).id;
}
async function cookieFor(email: string, secret = SECRET) {
  const u = await prisma.user.findFirstOrThrow({ where: { email } });
  const token = await encode({ token: { uid: u.id, sv: u.sessionVersion }, secret, salt: COOKIE });
  return `${COOKIE}=${token}`;
}
function connect(cookie: string | null, origin = url): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(url, {
      transports: ["websocket"], reconnection: false, forceNew: true,
      extraHeaders: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    });
    sockets.push(s);
    s.on("connect", () => resolve(s));
    s.on("connect_error", (e) => reject(e));
  });
}
const join = (s: Socket, ticketId: string) =>
  new Promise<{ ok: boolean; internal?: boolean; error?: string }>((r) => s.emit("ticket:join", ticketId, r));
const next = <T>(s: Socket, event: string, ms = 3000) =>
  new Promise<T | "timeout">((resolve) => {
    const t = setTimeout(() => resolve("timeout"), ms);
    s.once(event, (p: T) => { clearTimeout(t); resolve(p); });
  });

let ticketId = "";

beforeAll(async () => {
  http = createServer();
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  io = createRealtimeServer(http, { db: prisma, secret: SECRET, allowedOrigins: [url] });
  const emma = (await loadActor(prisma, await userId("emma@contoso.example")))!;
  ticketId = (await createTicket(emma, {
    subject: "Realtime test ticket", description: "Testing realtime delivery of chat events.",
    categoryId: (await prisma.category.findUniqueOrThrow({ where: { code: "REQ" } })).id,
    subcategoryId: (await prisma.category.findUniqueOrThrow({ where: { code: "REQ-SW" } })).id,
  })).id;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await new Promise<void>((r) => io.close(() => r()));
  await prisma.$disconnect();
});

describe("socket authentication", () => {
  it("rejects missing, forged and wrong-secret cookies", async () => {
    await expect(connect(null)).rejects.toThrow(/unauthorized/);
    await expect(connect(`${COOKIE}=not-a-jwt`)).rejects.toThrow(/unauthorized/);
    await expect(connect(await cookieFor("emma@contoso.example", "another-secret-0123456789abcdef0123456789"))).rejects.toThrow(/unauthorized/);
  });
  it("rejects foreign origins", async () => {
    await expect(connect(await cookieFor("emma@contoso.example"), "https://evil.example")).rejects.toThrow();
  });
  it("rejects deactivated users and revoked sessions", async () => {
    const id = await userId("fiona@fabrikam.example");
    const cookie = await cookieFor("fiona@fabrikam.example");
    await prisma.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
    await expect(connect(cookie)).rejects.toThrow(/unauthorized/);
    await prisma.user.update({ where: { id }, data: { status: "INACTIVE" } });
    await expect(connect(await cookieFor("fiona@fabrikam.example"))).rejects.toThrow(/unauthorized/);
    await prisma.user.update({ where: { id }, data: { status: "ACTIVE" } });
  });
  it("accepts a valid session", async () => {
    const s = await connect(await cookieFor("emma@contoso.example"));
    expect(s.connected).toBe(true);
  });
});

describe("room authorization & delivery", () => {
  it("refuses rooms outside the user's scope; internal room only for staff", async () => {
    const fiona = await connect(await cookieFor("fiona@fabrikam.example"));
    expect(await join(fiona, ticketId)).toMatchObject({ ok: false, error: "forbidden" });
    const emma = await connect(await cookieFor("emma@contoso.example"));
    expect(await join(emma, ticketId)).toEqual({ ok: true, internal: false });
    const ana = await connect(await cookieFor("ana.agent@contoso.example"));
    expect(await join(ana, ticketId)).toEqual({ ok: true, internal: true });
  });

  it("delivers message signals (no content) and notifications after commit; internal notes never reach the requester", async () => {
    const emma = await connect(await cookieFor("emma@contoso.example"));
    const ana = await connect(await cookieFor("ana.agent@contoso.example"));
    await join(emma, ticketId);
    await join(ana, ticketId);
    const anaActor = (await loadActor(prisma, await userId("ana.agent@contoso.example")))!;

    const emmaMsg = next<{ ticketId: string; messageId: string }>(emma, "message:new");
    const emmaNotify = next<{ type: string; title: string }>(emma, "notify");
    await postMessage(anaActor, ticketId, { body: "Public hello from support" });
    const m = await emmaMsg;
    expect(m).toMatchObject({ ticketId });
    expect(JSON.stringify(m)).not.toContain("Public hello"); // signals carry no message body
    expect(await emmaNotify).toMatchObject({ type: "NEW_MESSAGE" });

    const emmaSees = next(emma, "message:new", 1500);
    const anaSees = next<{ ticketId: string }>(ana, "message:new", 3000);
    await postMessage(anaActor, ticketId, { type: "INTERNAL", body: "Internal only" });
    expect(await anaSees).toMatchObject({ ticketId });
    expect(await emmaSees).toBe("timeout");
  });

  it("pushes session revocation to the user", async () => {
    const lee = await connect(await cookieFor("lee.lead@contoso.example"));
    const leeActor = (await loadActor(prisma, await userId("lee.lead@contoso.example")))!;
    const revoked = next(lee, "session:revoked");
    const admin = (await loadActor(prisma, await userId("super.admin@contoso.example")))!;
    const { revokeUserSessions } = await import("@/server/services/admin/users");
    await revokeUserSessions(admin, leeActor.id);
    expect(await revoked).not.toBe("timeout");
    // and the revoked session can no longer join rooms (socket is disconnected on next check)
    const r = await Promise.race([join(lee, ticketId), new Promise((res) => lee.once("disconnect", () => res("disconnected")))]);
    expect(r).toBe("disconnected");
  });
});
