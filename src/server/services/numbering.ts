import type { Prisma } from "@prisma/client";

/**
 * Formats a sequence number. Tokens: {PREFIX} {YYYY} {YY} {MM} {SEQ:n}
 *   formatNumber("{PREFIX}-{YYYY}-{SEQ:6}", "IT", 2026, 1) → "IT-2026-000001"
 */
export function formatNumber(format: string, prefix: string, date: Date, seq: number): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return format
    .replaceAll("{PREFIX}", prefix)
    .replaceAll("{YYYY}", yyyy)
    .replaceAll("{YY}", yyyy.slice(2))
    .replaceAll("{MM}", mm)
    .replace(/\{SEQ(?::(\d{1,2}))?\}/g, (_, w) => String(seq).padStart(w ? Number(w) : 1, "0"));
}

export function validateNumberFormat(format: string): string | null {
  if (!/\{SEQ(?::\d{1,2})?\}/.test(format)) return "Format must contain a {SEQ} or {SEQ:n} token.";
  const stripped = format.replace(/\{(PREFIX|YYYY|YY|MM|SEQ(?::\d{1,2})?)\}/g, "");
  if (/[{}]/.test(stripped)) return "Format contains an unknown token.";
  if (!/^[A-Za-z0-9\-_/.]*$/.test(stripped)) return "Format may only contain letters, digits and - _ / .";
  return null;
}

/**
 * Atomically allocates the next number for a sequence. Must be called inside a
 * transaction; the row lock from UPDATE … RETURNING serialises concurrent callers.
 * With resetYearly, the counter restarts at 1 when the year changes.
 */
export async function nextNumber(tx: Prisma.TransactionClient, key: string, now = new Date()): Promise<string> {
  const year = now.getFullYear();
  const rows = await tx.$queryRaw<{ prefix: string; format: string; current: number }[]>`
    UPDATE "NumberSequence"
       SET "current"   = CASE WHEN "resetYearly" AND "year" <> ${year} THEN 1 ELSE "current" + 1 END,
           "year"      = ${year},
           "updatedAt" = NOW()
     WHERE "key" = ${key}
 RETURNING "prefix", "format", "current"`;
  const row = rows[0];
  if (!row) throw new Error(`Number sequence "${key}" is not configured.`);
  return formatNumber(row.format, row.prefix, now, row.current);
}
