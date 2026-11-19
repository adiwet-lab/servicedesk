import { clientIp as resolveClientIp, REMOTE_ADDR_HEADER } from "@/server/net";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { Server, type Socket } from "socket.io";
import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/server/authz/actor";
import { canReadInternalNotes } from "@/server/authz/messages";
import { ticketScopeWhere } from "@/server/authz/scope";
import { registerEmitter, rooms } from "./bus";
import { actorForIdentity, identityFromCookie, type SocketIdentity } from "./auth";

export interface RealtimeOptions {
  db: PrismaClient;
  secret: string;
  /** Allowed browser origins (e.g. APP_URL). */
  allowedOrigins: string[];
  revalidateMs?: number;
  redisUrl?: string;
}

interface SocketData {
  identity: SocketIdentity;
  actorId: string;
}

function clientIp(req: IncomingMessage) {
  const get = (name: string) => {
    if (name === REMOTE_ADDR_HEADER) return req.socket.remoteAddress ?? null; // never trust a client-sent value
    const v = req.headers[name];
    return (Array.isArray(v) ? v.join(",") : v) ?? null;
  };
  return resolveClientIp({ get });
}

/**
 * Socket.IO server: authenticates with the Auth.js session cookie, re-validates
 * the actor on every room join and periodically, and only joins ticket rooms
 * the actor may see (internal room only for internal-note readers).
 */
export function createRealtimeServer(httpServer: HttpServer, opts: RealtimeOptions): Server {
  const origins = new Set(opts.allowedOrigins.map((o) => new URL(o).origin));
  const io = new Server(httpServer, {
    path: "/socket.io",
    serveClient: false,
    // Leave non-Socket.IO upgrades (e.g. Next.js HMR) alone.
    destroyUpgrade: false,
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(null, !!origin && origins.has(origin));
    },
    pingInterval: 25_000,
  });

  if (opts.redisUrl) {
    void (async () => {
      const [{ createAdapter }, { createClient }] = await Promise.all([import("@socket.io/redis-adapter"), import("redis")]);
      const pub = createClient({ url: opts.redisUrl });
      const sub = pub.duplicate();
      await Promise.all([pub.connect(), sub.connect()]);
      io.adapter(createAdapter(pub, sub));
      console.log("[realtime] Redis adapter enabled");
    })().catch((e) => console.error("[realtime] Redis adapter failed — running single-instance", e));
  }

  const loadActor = async (socket: Socket): Promise<Actor | null> => {
    const data = socket.data as SocketData;
    return actorForIdentity(opts.db, data.identity, clientIp(socket.request));
  };

  io.use(async (socket, next) => {
    const identity = await identityFromCookie(socket.request.headers.cookie, opts.secret);
    if (!identity) return next(new Error("unauthorized"));
    const actor = await actorForIdentity(opts.db, identity, clientIp(socket.request));
    if (!actor) return next(new Error("unauthorized"));
    (socket.data as SocketData) = { identity, actorId: actor.id };
    next();
  });

  io.on("connection", (socket) => {
    const data = socket.data as SocketData;
    void socket.join(rooms.user(data.actorId));

    const revalidate = setInterval(async () => {
      if (!(await loadActor(socket))) {
        socket.emit("session:revoked");
        socket.disconnect(true);
      }
    }, opts.revalidateMs ?? 5 * 60_000);
    socket.on("disconnect", () => clearInterval(revalidate));

    socket.on("ticket:join", async (ticketId: unknown, ack?: (r: { ok: boolean; internal?: boolean; error?: string }) => void) => {
      const reply = typeof ack === "function" ? ack : () => {};
      if (typeof ticketId !== "string" || ticketId.length > 50) return reply({ ok: false, error: "bad_request" });
      const actor = await loadActor(socket);
      if (!actor) {
        socket.emit("session:revoked");
        socket.disconnect(true);
        return;
      }
      const visible = await opts.db.ticket.count({ where: { AND: [ticketScopeWhere(actor), { id: ticketId }] } });
      if (!visible) return reply({ ok: false, error: "forbidden" });
      await socket.join(rooms.ticket(ticketId));
      const internal = canReadInternalNotes(actor);
      if (internal) await socket.join(rooms.ticketInternal(ticketId));
      reply({ ok: true, internal });
    });

    socket.on("ticket:leave", (ticketId: unknown) => {
      if (typeof ticketId !== "string") return;
      void socket.leave(rooms.ticket(ticketId));
      void socket.leave(rooms.ticketInternal(ticketId));
    });
  });

  registerEmitter({ emit: (e) => io.to(e.room).emit(e.event, e.payload) });
  return io;
}
