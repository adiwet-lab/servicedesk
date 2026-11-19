import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { can } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";
import { getSlaOverview } from "@/server/services/admin/system";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge, ColorBadge } from "@/components/ui/badge";
import { Alert, PageHeader } from "@/components/ui/misc";
import { formatMinutes } from "@/lib/utils";

export const metadata = { title: "SLA" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function SlaPage() {
  const actor = await requireAdminPortal();
  if (!can(actor, P.ADMIN_SLA)) notFound();
  const profiles = await getSlaOverview(actor);
  return (
    <div className="space-y-5">
      <PageHeader title="SLA Profiles & Business Hours" description="Due dates are calculated on ticket creation using business hours and holidays." />
      <Alert variant="warning">Phase 1 shows SLA configuration read-only and computes due dates on creation. Editing SLA targets, pause/resume recalculation, warnings, breach detection and escalations are delivered in <strong>Phase 4</strong>.</Alert>
      {profiles.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <CardTitle className="text-base">{p.name} {p.isDefault && <Badge className="ml-1">Default</Badge>}</CardTitle>
            <CardDescription>{p.description} · warning at {p.warningPercent}% · pauses on {(p.pauseStatusCodes as string[]).join(", ") || "—"}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-2">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Priority</TableHead><TableHead>Response</TableHead><TableHead>Resolution</TableHead><TableHead>Clock</TableHead></TableRow></TableHeader>
              <TableBody>
                {p.targets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell><ColorBadge color={t.priority.color}>{t.priority.code} {t.priority.name}</ColorBadge></TableCell>
                    <TableCell>{formatMinutes(t.responseMinutes)}</TableCell>
                    <TableCell>{formatMinutes(t.resolutionMinutes)}</TableCell>
                    <TableCell>{t.businessHoursOnly ? <Badge variant="secondary">Business hours</Badge> : <Badge variant="outline">24×7</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {p.businessHours && (
              <div className="space-y-2 text-sm">
                <p className="font-medium">{p.businessHours.name} <span className="text-muted-foreground">({p.businessHours.timezone})</span></p>
                <ul className="grid grid-cols-2 gap-1">
                  {DAYS.map((d, i) => {
                    const w = (p.businessHours!.schedule as Record<string, { start: string; end: string }[]>)[String(i + 1)] ?? [];
                    return <li key={d} className="flex justify-between rounded bg-muted/50 px-2 py-1"><span>{d}</span><span className="text-muted-foreground">{w.length ? w.map((x) => `${x.start}–${x.end}`).join(", ") : "Closed"}</span></li>;
                  })}
                </ul>
                <p className="pt-2 font-medium">Escalation rules</p>
                <ul className="text-muted-foreground">{p.escalations.map((e) => <li key={e.id}>{e.clock} at {e.atPercent}% → notify team lead</li>)}</ul>
                <p className="text-muted-foreground">{p.businessHours.holidays.length} holiday(s) configured.</p>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
