/** One-shot SLA & housekeeping sweep: `pnpm jobs:run` (cron / Azure Container Apps Job). */
import { prisma } from "@/server/db";
import { runSlaSweep } from "@/server/jobs/sla-sweep";

runSlaSweep()
  .then((r) => {
    console.log(JSON.stringify(r));
    process.exitCode = r.errors > 0 ? 1 : 0;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
