"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { runSlaCheckAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

export function RunSlaButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" disabled={pending} data-testid="run-sla" onClick={() => start(async () => {
        const r = await runSlaCheckAction();
        if (!r.ok || !r.data) { setResult(r.ok ? "Done." : r.error); return; }
        const d = r.data;
        setResult(d.skipped ? "Another instance is running the SLA check right now — try again in a moment."
          : `Checked: ${d.warnings} warning(s), ${d.breaches} breach(es), ${d.escalations} escalation(s), ${d.tasksOverdue} overdue task(s), ${d.autoClosed} auto-closed, ${d.backfilled} backfilled in ${d.durationMs} ms.`);
        router.refresh();
      })}><Play /> {pending ? "Running…" : "Run SLA check now"}</Button>
      {result && <span className="text-sm text-muted-foreground" data-testid="run-sla-result">{result}</span>}
    </div>
  );
}
