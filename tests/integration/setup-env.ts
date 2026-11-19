import { inject } from "vitest";

// Point the app's Prisma client at the per-run test database before any app module loads.
process.env.DATABASE_URL = inject("databaseUrl");
// Test-only key for integration secrets (never used outside the throwaway test database).
process.env.INTEGRATIONS_KEY ??= Buffer.alloc(32, 7).toString("base64");
