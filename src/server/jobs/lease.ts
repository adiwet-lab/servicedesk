import type { PrismaClient } from "@prisma/client";

/**
 * Database lease so only one app instance runs a job at a time (multi-replica safe).
 * Atomic: inserts or takes over an expired lease in a single statement.
 */
export async function acquireLease(db: PrismaClient, key: string, holder: string, ttlMs: number): Promise<boolean> {
  const until = new Date(Date.now() + ttlMs).toISOString();
  const value = JSON.stringify({ holder, until });
  const rows = await db.$queryRaw<{ key: string }[]>`
    INSERT INTO "SystemSetting" ("key", "value", "updatedAt") VALUES (${key}, ${value}::jsonb, NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
      WHERE ("SystemSetting"."value"->>'until')::timestamptz < NOW()
    RETURNING "key"`;
  return rows.length === 1;
}

export async function releaseLease(db: PrismaClient, key: string, holder: string) {
  await db.$executeRaw`
    UPDATE "SystemSetting" SET "value" = jsonb_set("value", '{until}', to_jsonb(NOW()::text)), "updatedAt" = NOW()
     WHERE "key" = ${key} AND "value"->>'holder' = ${holder}`;
}
