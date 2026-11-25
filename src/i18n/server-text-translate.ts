import { messagesFor } from "./messages";
import type { Locale } from "./config";

/**
 * Server (service-layer) messages are written in English. They are translated at the boundary
 * (server actions) through the `srv` catalog, looked up by their English text; messages with
 * values use the `srvTpl` patterns ({name} = any text); `validation.*` strings are catalog keys.
 * Text without a translation is returned unchanged (English).
 */
const TERM_PARAMS = new Set(["clock", "status", "field"]);
type Entry = { re: RegExp; names: string[]; target: string };
const cache = new Map<Locale, { exact: Map<string, string>; patterns: Entry[]; validation: Record<string, string> }>();

function tables(locale: Locale) {
  let t = cache.get(locale);
  if (!t) {
    const en = messagesFor("en"), loc = messagesFor(locale);
    const exact = new Map<string, string>();
    for (const [k, v] of Object.entries(en.srv as Record<string, string>)) exact.set(v, (loc.srv as Record<string, string>)[k] ?? v);
    const patterns: Entry[] = Object.entries(en.srvTpl as Record<string, string>).map(([k, v]) => {
      const names: string[] = [];
      const src = v.split(/(\{\w+\})/).map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (m) { names.push(m[1]); return "(.+?)"; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }).join("");
      return { re: new RegExp(`^${src}$`, "s"), names, target: (loc.srvTpl as Record<string, string>)[k] ?? v };
    });
    t = { exact, patterns, validation: loc.validation as Record<string, string> };
    cache.set(locale, t);
  }
  return t;
}

export function translateServerText(text: string, locale: Locale): string {
  if (text.startsWith("validation.")) {
    const v = tables(locale).validation[text.slice("validation.".length)];
    return v ?? text;
  }
  if (locale === "en") return text;
  const t = tables(locale);
  const hit = t.exact.get(text);
  if (hit) return hit;
  for (const p of t.patterns) {
    const m = p.re.exec(text);
    // Values named clock/status are fixed terms ("response", a major-incident status) and are translated too;
    // other values (names, numbers, free text) are kept as they are.
    if (m) return p.names.reduce((out, n, i) => out.split(`{${n}}`).join(TERM_PARAMS.has(n) ? t.exact.get(m[i + 1]!) ?? m[i + 1]! : m[i + 1]!), p.target);
  }
  return text;
}

export function translateFieldErrors(fe: Record<string, string> | undefined, locale: Locale) {
  if (!fe) return fe;
  return Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, translateServerText(v, locale)]));
}
