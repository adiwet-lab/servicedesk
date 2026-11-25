import { AuthorizationError, NotFoundError, RateLimitError, ValidationError } from "@/server/authz/errors";
import { translateFieldErrors, translateServerText } from "@/i18n/server-text-translate";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";

/** Request locale for messages; falls back to the default outside a request (e.g. tests). */
async function messageLocale(): Promise<Locale> {
  try {
    const { getLocale } = await import("next-intl/server");
    const l = await getLocale();
    return isLocale(l) ? l : DEFAULT_LOCALE;
  } catch {
    return "en";
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Converts domain errors into serialisable results; unexpected errors are logged and masked. */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: message && translateServerText(message, await messageLocale()) };
  } catch (e) {
    if (e instanceof ValidationError) {
      const l = await messageLocale();
      return { ok: false, error: translateServerText(e.message, l), fieldErrors: translateFieldErrors(e.fieldErrors, l) };
    }
    if (e instanceof AuthorizationError || e instanceof NotFoundError || e instanceof RateLimitError) return { ok: false, error: translateServerText(e.message, await messageLocale()) };
    // Let Next.js redirects / notFound propagate.
    if (e && typeof e === "object" && "digest" in e && typeof (e as { digest: unknown }).digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_")) throw e;
    console.error("[action] unexpected error", e);
    return { ok: false, error: translateServerText("Something went wrong. Please try again or contact IT.", await messageLocale()) };
  }
}

export function formToObject(fd: FormData, multi: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (v instanceof File) continue;
    if (multi.includes(k)) {
      const arr = (out[k] as string[] | undefined) ?? [];
      arr.push(String(v));
      out[k] = arr;
    } else out[k] = v;
  }
  for (const m of multi) out[m] ??= [];
  return out;
}

export async function filesFromForm(fd: FormData, field = "attachments") {
  const files = fd.getAll(field).filter((f): f is File => f instanceof File && f.size > 0);
  return Promise.all(files.map(async (f) => ({ name: f.name, size: f.size, data: Buffer.from(await f.arrayBuffer()) })));
}
