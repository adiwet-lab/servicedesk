/**
 * Minimal outbound HTTP client for integrations: timeout, no redirects (a redirect
 * could bypass the host allow-list), bounded response size, Retry-After support.
 */
export class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs: number | null = null, readonly body = "") { super(message); }
}

const MAX_BYTES = 5 * 1024 * 1024;

export async function httpRequest(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, { method: init.method ?? "GET", headers: init.headers, body: init.body, redirect: "manual", signal: ctrl.signal });
    const buf = await readLimited(res);
    const text = buf.toString("utf8");
    if (res.status >= 300 && res.status < 400) throw new HttpError(`Unexpected redirect (${res.status}).`, res.status);
    if (!res.ok) {
      const ra = res.headers.get("retry-after");
      const retryAfterMs = ra ? (/^\d+$/.test(ra) ? Number(ra) * 1000 : Math.max(0, Date.parse(ra) - Date.now())) : null;
      throw new HttpError(`HTTP ${res.status}`, res.status, Number.isFinite(retryAfterMs) ? retryAfterMs : null, text.slice(0, 500));
    }
    return { status: res.status, text };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if ((e as Error).name === "AbortError") throw new HttpError("Request timed out.", 0);
    throw new HttpError(`Network error: ${(e as Error).message}`, 0);
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(res: Response): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new HttpError("Response too large.", 0); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function httpJson<T = unknown>(url: string, init: Parameters<typeof httpRequest>[1] = {}): Promise<T> {
  const r = await httpRequest(url, { ...init, headers: { Accept: "application/json", ...(init.headers ?? {}) } });
  try { return (r.text ? JSON.parse(r.text) : null) as T; } catch { throw new HttpError("Invalid JSON response.", r.status); }
}
