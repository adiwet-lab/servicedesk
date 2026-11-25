"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { saveBusinessHoursAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { useTranslations } from "next-intl";

type Win = { start: string; end: string };
export interface CalendarData { id: string | null; name: string; timezone: string; isDefault: boolean; schedule: Record<string, Win[]> }
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function BusinessHoursForm({ calendar, timezones }: { calendar: CalendarData; timezones: string[] }) {
  const tcfg = useTranslations("cfg");
  const [c, setC] = useState(calendar);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const setDay = (d: string, wins: Win[]) => setC((x) => ({ ...x, schedule: { ...x.schedule, [d]: wins } }));
  const weeklyHours = useMemo(() => Object.values(c.schedule).flat().reduce((a, w) => {
    const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
    return a + Math.max(0, m(w.end) - m(w.start));
  }, 0) / 60, [c.schedule]);

  return (
    <Card data-testid={`calendar-${calendar.name || "new"}`}>
      <CardHeader><CardTitle className="text-base">{calendar.id ? calendar.name : tcfg("newCalendar")} <span className="ml-2 text-sm font-normal text-muted-foreground">{tcfg("weeklyHours", { h: weeklyHours.toFixed(1) })}</span></CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {msg && <Alert variant={msg.ok ? "success" : "destructive"}>{msg.text}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={tcfg("name")} htmlFor={`bh-name-${calendar.id}`}><Input id={`bh-name-${calendar.id}`} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
          <Field label={tcfg("timezone")} htmlFor={`bh-tz-${calendar.id}`}>
            <NativeSelect id={`bh-tz-${calendar.id}`} value={c.timezone} onChange={(e) => setC({ ...c, timezone: e.target.value })}>
              {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </NativeSelect>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={c.isDefault} onChange={(e) => setC({ ...c, isDefault: e.target.checked })} className="size-4 accent-primary" /> {tcfg("defaultCalendar")}</label>
        </div>
        <div className="divide-y rounded-lg border">
          {DAYS.map((dk, i) => {
            const name = tcfg(`day.${dk}`);
            const d = String(i + 1);
            const wins = c.schedule[d] ?? [];
            return (
              <div key={d} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <label className="flex w-32 items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={wins.length > 0} className="accent-primary" aria-label={tcfg("dayWorking", { day: name })}
                    onChange={(e) => setDay(d, e.target.checked ? [{ start: "08:30", end: "17:30" }] : [])} /> {name}
                </label>
                {wins.length === 0 && <span className="text-sm text-muted-foreground">{tcfg("closed")}</span>}
                {wins.map((w, j) => (
                  <span key={j} className="flex items-center gap-1">
                    <Input type="time" value={w.start} className="w-28" aria-label={tcfg("dayStart", { day: name, n: j + 1 })} data-testid={`bh-${d}-start-${j}`}
                      onChange={(e) => setDay(d, wins.map((x, k) => (k === j ? { ...x, start: e.target.value } : x)))} />
                    –
                    <Input type="time" value={w.end} className="w-28" aria-label={tcfg("dayEnd", { day: name, n: j + 1 })} data-testid={`bh-${d}-end-${j}`}
                      onChange={(e) => setDay(d, wins.map((x, k) => (k === j ? { ...x, end: e.target.value } : x)))} />
                    {j > 0 && <button type="button" onClick={() => setDay(d, wins.filter((_, k) => k !== j))} aria-label={tcfg("removeWindow")}><Trash2 className="size-4 text-destructive" /></button>}
                  </span>
                ))}
                {wins.length > 0 && wins.length < 2 && (
                  <button type="button" className="flex items-center gap-1 text-xs text-primary" onClick={() => setDay(d, [...wins, { start: "13:00", end: "17:00" }])}><Plus className="size-3" /> {tcfg("splitShift")}</button>
                )}
              </div>
            );
          })}
        </div>
        <Button disabled={pending} data-testid="save-business-hours" onClick={() => start(async () => {
          const res = await saveBusinessHoursAction(calendar.id, { name: c.name, timezone: c.timezone, isDefault: c.isDefault, schedule: c.schedule });
          setMsg(res.ok ? { ok: true, text: tcfg("bhSaved") } : { ok: false, text: res.error });
          if (res.ok) router.refresh();
        })}>{pending ? tcfg("saving") : tcfg("saveCalendar")}</Button>
      </CardContent>
    </Card>
  );
}
