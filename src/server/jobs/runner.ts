import { runSlaSweep, type SweepResult } from "./sla-sweep";
import { prisma } from "@/server/db";
import { processOutbox } from "@/server/integrations/outbox";
import { runDueGraphSyncs } from "@/server/integrations/graph";
import { getSetting } from "@/server/services/settings";
import { runExpiryNotices } from "@/server/services/admin/access-review";

/**
 * In-process job runner (started by server.ts). Multiple instances are safe:
 * the sweep takes a database lease, so only one instance works per interval.
 * For serverless / job-based hosting, disable it (JOBS_ENABLED=false) and run
 * `pnpm jobs:run` from Azure Container Apps Jobs, Functions or cron instead.
 */
export function startJobRunner(opts: { intervalSeconds?: number; log?: (msg: string) => void } = {}) {
  const intervalMs = Math.max(15, opts.intervalSeconds ?? 60) * 1000;
  const log = opts.log ?? ((m: string) => console.log(m));
  let running = false;
  let lastGraphCheck = 0;
  let lastExpiryCheck = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r: SweepResult = await runSlaSweep();
      const changed = r.backfilled + r.warnings + r.breaches + r.escalations + r.tasksOverdue + r.autoClosed;
      if (!r.skipped && (changed > 0 || r.errors > 0)) {
        log(`[jobs] sla sweep: ${r.warnings} warning(s), ${r.breaches} breach(es), ${r.escalations} escalation(s), ${r.tasksOverdue} overdue task(s), ${r.autoClosed} auto-closed, ${r.backfilled} backfilled, ${r.errors} error(s) in ${r.durationMs}ms`);
      }
    } catch (e) {
      console.error("[jobs] sla sweep failed", e);
    }
    try {
      const o = await processOutbox();
      if (!o.skipped && o.sent + o.failed + o.dead > 0) log(`[jobs] outbox: ${o.sent} sent, ${o.failed} retrying, ${o.dead} dead`);
    } catch (e) {
      console.error("[jobs] outbox failed", e);
    }
    // Access-expiry notices: hourly check, each user notified once per expiry window.
    if (Date.now() - lastExpiryCheck > 60 * 60_000) {
      lastExpiryCheck = Date.now();
      try {
        const x = await runExpiryNotices();
        if (x.notified) log(`[jobs] access expiry: ${x.notified} notice(s)`);
      } catch (e) {
        console.error("[jobs] access expiry failed", e);
      }
    }
    // Directory sync: checked at most every 10 minutes; each tenant syncs per its interval.
    if (Date.now() - lastGraphCheck > 10 * 60_000) {
      lastGraphCheck = Date.now();
      try {
        for (const s of await runDueGraphSyncs(await getSetting(prisma, "integrations.graph.syncIntervalHours"))) log(`[jobs] graph sync ${s.tenant}: ${JSON.stringify(s.result)}`);
      } catch (e) {
        console.error("[jobs] graph sync failed", e);
      }
    }
    running = false;
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, intervalMs);
  return () => { clearTimeout(first); clearInterval(timer); };
}
