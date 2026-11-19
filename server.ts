/**
 * Custom Node server: Next.js + Socket.IO on one port.
 *   dev:   pnpm dev   (tsx watch server.ts)
 *   prod:  pnpm build && pnpm start   (node dist/server.js)
 */
import { createServer } from "node:http";
import next from "next";
import { prisma } from "@/server/db";
import { createRealtimeServer } from "@/server/realtime/socket-server";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const appUrl = process.env.APP_URL ?? `http://localhost:${port}`;

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer((req, res) => {
    void handle(req, res);
  });
  // Next.js dev HMR uses websocket upgrades on the same server.
  const upgrade = app.getUpgradeHandler();
  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/socket.io")) void upgrade(req, socket, head);
  });

  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret) console.warn("[realtime] AUTH_SECRET is not set — realtime connections will be rejected");
  const allowedOrigins = [appUrl, ...(dev ? [`http://localhost:${port}`, `http://127.0.0.1:${port}`] : [])];
  createRealtimeServer(server, { db: prisma, secret, allowedOrigins, redisUrl: process.env.REDIS_URL || undefined });

  server.listen(port, hostname, () => {
    console.log(`> Service Desk ready on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port} (${dev ? "development" : "production"}, realtime enabled)`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
