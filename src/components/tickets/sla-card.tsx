import { Clock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/server/db";
import { getTicketSla } from "@/server/services/sla";
import type { ClockState } from "@/server/domain/sla-engine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getFormat } from "@/i18n/server";
import type { Formatter } from "@/lib/format";

const VARIANT: Record<ClockState, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  ON_TRACK: "success", WARNING: "warning", BREACHED: "destructive", MET: "success", MET_LATE: "destructive", PAUSED: "secondary", NONE: "outline",
};
const EVENTS = ["STARTED", "PAUSED", "RESUMED", "WARNING", "BREACHED", "MET", "ESCALATED"] as const;
type T = Awaited<ReturnType<typeof getTranslations<"slaCard">>>;

function ClockRow({ id, name, clock, warningPercent, unit, t, f }: {
  id: "response" | "resolution"; name: string; unit: string; warningPercent: number; t: T; f: Formatter;
  clock: { state: ClockState; dueAt: Date | null; remainingMinutes: number | null; elapsedPercent: number | null; targetMinutes: number | null };
}) {
  if (clock.state === "NONE") return <div className="text-sm"><span className="font-medium">{name}</span> <span className="text-muted-foreground">{t("noTarget")}</span></div>;
  const pct = Math.min(100, Math.max(0, clock.elapsedPercent ?? 0));
  const bar = clock.state === "BREACHED" || clock.state === "MET_LATE" ? "bg-destructive" : (clock.elapsedPercent ?? 0) >= warningPercent && clock.state !== "MET" ? "bg-warning" : "bg-success";
  const rem = clock.remainingMinutes ?? 0;
  const done = clock.state === "MET" || clock.state === "MET_LATE";
  const time = f.duration(rem);
  return (
    <div className="space-y-1.5" data-testid={`sla-clock-${id}`} data-state={clock.state}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{name}</span>
        <Badge variant={VARIANT[clock.state]}>{t(`state.${clock.state}`)}</Badge>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", bar)} style={{ width: `${pct}%` }} /></div>
      <p className="text-xs text-muted-foreground">
        {t("target", { target: f.duration(clock.targetMinutes ?? 0), unit })} · {done ? (rem >= 0 ? t("metSpare", { time }) : t("metLate", { time }))
          : rem >= 0 ? t("left", { time, unit }) : t("overdue", { time })}
        {clock.dueAt && !done && <> · {t("due")} {clock.state === "PAUSED" ? `${t("pausedParen")} ` : ""}{f.dateTime(clock.dueAt)}</>}
      </p>
    </div>
  );
}

export async function SlaCard({ ticketId }: { ticketId: string }) {
  const [sla, t, f] = await Promise.all([getTicketSla(prisma, ticketId), getTranslations("slaCard"), getFormat()]);
  const unit = sla.businessHours ? t("businessTime") : t("allDayUnit");
  const clockName = (c: string) => (c === "RESPONSE" ? t("response") : t("resolution"));
  return (
    <Card data-testid="sla-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Clock className="size-4" /> {t("title")} {sla.paused && <Badge variant="secondary">{t("clockPaused")}</Badge>}</CardTitle>
        <p className="text-xs text-muted-foreground">{sla.profileName ?? t("noProfile")}{sla.calendarName ? ` · ${sla.calendarName}` : sla.profileName ? ` · ${t("allDay")}` : ""} · {t("warningAt", { pct: sla.warningPercent })}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ClockRow id="response" name={t("response")} clock={sla.response} warningPercent={sla.warningPercent} unit={unit} t={t} f={f} />
        <ClockRow id="resolution" name={t("resolution")} clock={sla.resolution} warningPercent={sla.warningPercent} unit={unit} t={t} f={f} />
        {sla.events.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">{t("events", { count: sla.events.length })}</summary>
            <ul className="mt-2 space-y-1" data-testid="sla-events">
              {sla.events.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="w-28 shrink-0 text-muted-foreground">{f.dateTime(e.createdAt)}</span>
                  <span><span className="font-medium">{clockName(e.clock)} {(EVENTS as readonly string[]).includes(e.type) ? t(`event.${e.type as (typeof EVENTS)[number]}`) : e.type}</span>{e.detail && !e.detail.startsWith("rule:") ? ` — ${e.detail}` : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
