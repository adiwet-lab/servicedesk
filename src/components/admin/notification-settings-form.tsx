"use client";
import { useActionState } from "react";
import { saveNotificationSettingsAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function NotificationSettingsForm({ types, disabled, channels }: {
  types: { code: string; label: string }[]; disabled: string[]; channels: { id: string; label: string; configured: boolean }[];
}) {
  const [state, action, pending] = useActionState(saveNotificationSettingsAction, null);
  return (
    <form action={action} className="space-y-4">
      {state?.ok && <Alert variant="success">Notification settings saved.</Alert>}
      {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Event</TableHead>
              {channels.map((c) => <TableHead key={c.id} className="text-center">{c.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((t) => (
              <TableRow key={t.code}>
                <TableCell><p className="font-medium">{t.label}</p><code className="text-[11px] text-muted-foreground">{t.code}</code></TableCell>
                {channels.map((c) => (
                  <TableCell key={c.id} className="text-center">
                    {c.configured ? (
                      <input type="checkbox" name="enabled" value={t.code} defaultChecked={!disabled.includes(t.code)} className="size-4 accent-primary" aria-label={`${t.label} – ${c.label}`} />
                    ) : <Badge variant="outline" className="text-[10px]">Not configured</Badge>}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Button type="submit" disabled={pending}>Save notification settings</Button>
    </form>
  );
}
