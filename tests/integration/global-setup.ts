import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Creates a fresh, uniquely-named throwaway database for this test run, applies
 * migrations (non-destructive `migrate deploy`) and seeds it. The database is
 * dropped after the run (set KEEP_TEST_DB=1 to keep it for debugging).
 * Existing databases are never modified.
 *
 * TEST_DATABASE_ADMIN_URL must point at a server where the user may CREATE DATABASE.
 */
export default async function setup(project: TestProject) {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://servicedesk:servicedesk@localhost:5432/postgres";
  const name = `servicedesk_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  url.searchParams.set("schema", "public");
  const databaseUrl = url.toString();

  const admin = new PrismaClient({ datasourceUrl: adminUrl });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); // name is generated above, not user input
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });
  project.provide("databaseUrl", databaseUrl);

  return async () => {
    if (process.env.KEEP_TEST_DB === "1") {
      console.log(`Kept test database: ${name}`);
    } else {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
    await admin.$disconnect();
  };
}
