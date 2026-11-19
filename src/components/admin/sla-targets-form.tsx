"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSlaTargetsAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ColorBadge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Unit = "min" | "h" | "d";
interface Row { priorityId: string; code: string; name: string; color: string; responseMinutes: number; resolutionMinutes: number; businessHoursOnly: boolean }

/** Picks the most natural unit for display. */
function split(mins: number, dayLen: number): { value: number; unit: Unit } {
  if (mins % dayLen === 0) return { value: mins / dayLen, unit: "d" };
  if (mins % 60 === 0) return { value: mins / 60, unit: "h" };
  return { value: mins, unit: "min" };
}

function DurationInput({ label, minutes, dayLen, onChange, testId }: { label: string; minutes: number; dayLen: number; onChange: (m: number) => void; testId: string }) {
  const init = split(minutes, dayLen);
  const [value, setValue] = useState(String(init.value));
  const [unit, setUnit] = useState<Unit>(init.unit);
  const emit = (v: string, u: Unit) => {
    const n = Number(v);
    onChange(Number.isFinite(n) ? Math.round(n * (u === "d" ? dayLen : u === "h" ? 60 : 1)) : 0);
  };
  return (
    <div className="flex gap-1.5">
      <Input type="number" min={1} step="any" value={value} className="w-24" aria-label={label} data-testid={testId}
        onChange={(e) => { setValue(e.target.value); emit(e.target.value, unit); }} />
      <NativeSelect value={unit} className="w-36" aria-label={`${label} unit`} onChange={(e) => { const u = e.target.value as Unit; setUnit(u); emit(value, u); }}>
        <option value="min">minutes</option><option value="h">hours</option><option value="d">{dayLen === 1440 ? "days (24h)" : "business days"}</option>
      </NativeSelect>
    </div>
  );
}

export function SlaTargetsForm({ profileId, rows: initial, businessDayMinutes }: { profileId: string; rows: Row[]; businessDayMinutes: number }) {
  const [rows, setRows] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      {msg && <Alert variant={msg.ok ? "success" : "destructive"}>{msg.text}</Alert>}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent"><TableHead>Priority</TableHead><TableHead>Response time</TableHead><TableHead>Resolution time</TableHead><TableHead>Clock</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const dayLen = r.businessHoursOnly ? businessDayMinutes : 1440;
              return (
                <TableRow key={`${r.priorityId}-${r.businessHoursOnly}`}>
                  <TableCell><ColorBadge color={r.color}>{r.code} – {r.name}</ColorBadge></TableCell>
                  <TableCell><DurationInput label={`${r.code} response`} testId={`resp-${r.code}`} minutes={r.responseMinutes} dayLen={dayLen} onChange={(m) => update(i, { responseMinutes: m })} /></TableCell>
                  <TableCell><DurationInput label={`${r.code} resolution`} testId={`res-${r.code}`} minutes={r.resolutionMinutes} dayLen={dayLen} onChange={(m) => update(i, { resolutionMinutes: m })} /></TableCell>
                  <TableCell>
                    <NativeSelect value={r.businessHoursOnly ? "bh" : "247"} className="w-44" aria-label={`${r.code} clock`}
                      onChange={(e) => update(i, { businessHoursOnly: e.target.value === "bh" })}>
                      <option value="bh">Business hours</option><option value="247">24×7</option>
                    </NativeSelect>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">1 business day = {Math.round(businessDayMinutes / 6) / 10} working hours of this profile&apos;s calendar. Changes apply to new tickets and to tickets whose priority/category changes; open tickets keep their snapshot.</p>
      <Button disabled={pending} data-testid="save-targets" onClick={() => start(async () => {
        const res = await saveSlaTargetsAction(profileId, rows.map(({ priorityId, responseMinutes, resolutionMinutes, businessHoursOnly }) => ({ priorityId, responseMinutes, resolutionMinutes, businessHoursOnly })));
        setMsg(res.ok ? { ok: true, text: "SLA targets saved." } : { ok: false, text: res.error });
        if (res.ok) router.refresh();
      })}>{pending ? "Saving…" : "Save targets"}</Button>
    </div>
  );
}
