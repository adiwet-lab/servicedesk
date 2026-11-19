import { Clock } from "lucide-react";
import { prisma } from "@/server/db";
import { getTicketSla } from "@/server/services/sla";
import { CLOCK_STATE_LABEL, formatClockMinutes, type ClockState } from "@/server/domain/sla-engine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatDateTime } from "@/lib/utils";

const VARIANT: Record<ClockState, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  ON_TRACK: "success", WARNING: "warning", BREACHED: "destructive", MET: "success", MET_LATE: "destructive", PAUSED: "secondary", NONE: "outline",
};
const EVENT_LABEL: Record<string, string> = { STARTED: "Started", PAUSED: "Paused", RESUMED: "Resumed", WARNING: "Warning", BREACHED: "Breached", MET: "Met", ESCALATED: "Escalated" };

function ClockRow({ name, clock, warningPercent, unit }: {
  name: string; unit: string; warningPercent: number;
  clock: { state: ClockState; dueAt: Date | null; remainingMinutes: number | null; elapsedPercent: number | null; targetMinutes: number | null };
}) {
  if (clock.state === "NONE") return <div className="text-sm"><span className="font-medium">{name}</span> <span className="text-muted-foreground">— no target</span></div>;
  const pct = Math.min(100, Math.max(0, clock.elapsedPercent ?? 0));
  const bar = clock.state === "BREACHED" || clock.state === "MET_LATE" ? "bg-destructive" : (clock.elapsedPercent ?? 0) >= warningPercent && clock.state !== "MET" ? "bg-warning" : "bg-success";
  const rem = clock.remainingMinutes ?? 0;
  const done = clock.state === "MET" || clock.state === "MET_LATE";
  return (
    <div className="space-y-1.5" data-testid={`sla-clock-${name.toLowerCase()}`} data-state={clock.state}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{name}</span>
        <Badge variant={VARIANT[clock.state]}>{CLOCK_STATE_LABEL[clock.state]}</Badge>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", bar)} style={{ width: `${pct}%` }} /></div>
      <p className="text-xs text-muted-foreground">
        Target {formatClockMinutes(clock.targetMinutes ?? 0)} {unit} · {done ? (rem >= 0 ? `met with ${formatClockMinutes(rem)} to spare` : `met ${formatClockMinutes(rem)} late`)
          : rem >= 0 ? `${formatClockMinutes(rem)} ${unit} left` : `overdue by ${formatClockMinutes(rem)}`}
        {clock.dueAt && !done && <> · due {clock.state === "PAUSED" ? "(paused) " : ""}{formatDateTime(clock.dueAt)}</>}
      </p>
    </div>
  );
}

export async function SlaCard({ ticketId }: { ticketId: string }) {
  const sla = await getTicketSla(prisma, ticketId);
  const unit = sla.businessHours ? "business time" : "(24×7)";
  return (
    <Card data-testid="sla-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Clock className="size-4" /> SLA {sla.paused && <Badge variant="secondary">Clock paused</Badge>}</CardTitle>
        <p className="text-xs text-muted-foreground">{sla.profileName ?? "No SLA profile"}{sla.calendarName ? ` · ${sla.calendarName}` : sla.profileName ? " · 24×7" : ""} · warning at {sla.warningPercent}%</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ClockRow name="Response" clock={sla.response} warningPercent={sla.warningPercent} unit={unit} />
        <ClockRow name="Resolution" clock={sla.resolution} warningPercent={sla.warningPercent} unit={unit} />
        {sla.events.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">SLA events ({sla.events.length})</summary>
            <ul className="mt-2 space-y-1" data-testid="sla-events">
              {sla.events.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="w-28 shrink-0 text-muted-foreground">{formatDateTime(e.createdAt)}</span>
                  <span><span className="font-medium">{e.clock === "RESPONSE" ? "Response" : "Resolution"} {EVENT_LABEL[e.type] ?? e.type}</span>{e.detail && !e.detail.startsWith("rule:") ? ` — ${e.detail}` : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
