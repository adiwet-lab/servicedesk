import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Recorded { method: string; url: string; headers: IncomingMessage["headers"]; body: string }
export type Handler = (req: Recorded, res: ServerResponse) => void | Promise<void>;

/** Tiny local HTTP server for integration tests (Graph, Teams, asset system). */
export async function startMockServer(handler: Handler) {
  const requests: Recorded[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const rec = { method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
    requests.push(rec);
    try { await handler(rec, res); } catch (e) { res.statusCode = 500; res.end(String(e)); }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}
