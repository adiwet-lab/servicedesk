/** Pure helpers for dashboards & reports (unit-tested). */

export const AGING_BUCKETS = [
  { key: "0-1", label: "0–1 day", min: 0, max: 1 },
  { key: "2-3", label: "2–3 days", min: 2, max: 3 },
  { key: "4-7", label: "4–7 days", min: 4, max: 7 },
  { key: "8-14", label: "8–14 days", min: 8, max: 14 },
  { key: "15+", label: "More than 14 days", min: 15, max: Infinity },
] as const;
export type AgingKey = (typeof AGING_BUCKETS)[number]["key"];

/** Whole days elapsed (floor). A ticket opened 30 hours ago is 1 day old. */
export function ageInDays(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));
}

export function agingBucket(days: number): AgingKey {
  return AGING_BUCKETS.find((b) => days >= b.min && days <= b.max)!.key;
}

/** createdAt range (inclusive lower, exclusive upper) for an aging bucket, relative to now. */
export function agingRange(key: AgingKey, now: Date): { gt?: Date; lte?: Date } {
  const b = AGING_BUCKETS.find((x) => x.key === key)!;
  const day = 86_400_000;
  return {
    // age >= min  ⇔ createdAt <= now − min days
    lte: new Date(now.getTime() - b.min * day),
    // age <= max  ⇔ createdAt > now − (max+1) days
    ...(Number.isFinite(b.max) ? { gt: new Date(now.getTime() - (b.max + 1) * day) } : {}),
  };
}

export type Granularity = "day" | "week" | "month";

export function chooseGranularity(from: Date, to: Date): Granularity {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days <= 62) return "day";
  if (days <= 400) return "week";
  return "month";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Bucket key (UTC-based, ISO week starting Monday). */
export function periodKey(d: Date, g: Granularity): string {
  if (g === "month") return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  if (g === "week") {
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

/** All period keys from..to (inclusive) so charts have no gaps. */
export function periodKeys(from: Date, to: Date, g: Granularity): string[] {
  const keys: string[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (let i = 0; i < 2000 && cur <= to; i++) {
    const k = periodKey(cur, g);
    if (keys[keys.length - 1] !== k) keys.push(k);
    if (g === "month") cur.setUTCMonth(cur.getUTCMonth() + 1, 1);
    else cur.setUTCDate(cur.getUTCDate() + (g === "week" ? 7 : 1));
  }
  const last = periodKey(to, g);
  if (keys[keys.length - 1] !== last) keys.push(last);
  return keys;
}

export function periodLabel(key: string, g: Granularity): string {
  if (g === "month") {
    const [y, m] = key.split("-");
    return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  const d = new Date(`${key}T00:00:00Z`);
  const s = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  return g === "week" ? `wk ${s}` : s;
}

/** Percentage with one decimal; null when there is nothing to measure. */
export function compliance(met: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((met / total) * 1000) / 10;
}

export function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
}

/**
 * CSV cell escaping with spreadsheet formula-injection protection:
 * cells starting with = + - @ TAB CR are prefixed with a single quote.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}
