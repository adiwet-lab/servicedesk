import { runSlaSweep, type SweepResult } from "./sla-sweep";

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
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, intervalMs);
  return () => { clearTimeout(first); clearInterval(timer); };
}
