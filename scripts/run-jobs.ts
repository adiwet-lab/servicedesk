/** One-shot jobs run: SLA sweep, integration outbox, due directory syncs — `pnpm jobs:run` (cron / Azure Container Apps Job). */
import { prisma } from "@/server/db";
import { runSlaSweep } from "@/server/jobs/sla-sweep";
import { processOutbox } from "@/server/integrations/outbox";
import { runDueGraphSyncs } from "@/server/integrations/graph";
import { getSetting } from "@/server/services/settings";
import { runExpiryNotices } from "@/server/services/admin/access-review";

async function main() {
  const sla = await runSlaSweep();
  const outbox = await processOutbox();
  const graph = await runDueGraphSyncs(await getSetting(prisma, "integrations.graph.syncIntervalHours"));
  const accessExpiry = await runExpiryNotices();
  console.log(JSON.stringify({ sla, outbox, graph, accessExpiry }));
  process.exitCode = sla.errors > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
