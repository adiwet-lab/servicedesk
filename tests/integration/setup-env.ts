import { inject } from "vitest";

// Point the app's Prisma client at the per-run test database before any app module loads.
process.env.DATABASE_URL = inject("databaseUrl");
