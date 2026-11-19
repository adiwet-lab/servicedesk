/**
 * Archive audit logs: `pnpm audit:export --from 2026-01-01 --to 2026-01-31 [--format ndjson|csv] [--out file]`
 * Intended for scheduled jobs that ship the file to immutable storage (Blob time-based retention)
 * or Log Analytics. The export is audited as AUDIT_ARCHIVE_EXPORTED (actor: System).
 */
import { createWriteStream } from "node:fs";
import { prisma } from "@/server/db";
import { startAuditExport } from "@/server/services/admin/audit-export";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const format = arg("format") === "csv" ? "csv" : "ndjson";
  const { total, filter, chunks } = await startAuditExport(null, { from: arg("from"), to: arg("to") }, format);
  const out = arg("out") ? createWriteStream(arg("out")!) : process.stdout;
  for await (const c of chunks) if (!out.write(c)) await new Promise<void>((r) => out.once("drain", () => r()));
  if (out !== process.stdout) await new Promise<void>((r) => (out as ReturnType<typeof createWriteStream>).end(() => r()));
  console.error(`exported ${total} audit rows (${filter.from} … ${filter.to}, ${format})`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
