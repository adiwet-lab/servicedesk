import Link from "next/link";
import { HardDrive } from "lucide-react";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { ticketScopeWhere } from "@/server/authz/scope";
import { lookupAsset } from "@/server/integrations/assets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Asset details from the configured provider + other tickets for the same asset (within the viewer's scope). */
export async function AssetCard({ actor, ticketId, tag, ticketBase, staff }: { actor: Actor; ticketId: string; tag: string | null; ticketBase: string; staff: boolean }) {
  if (!tag) return null;
  const [r, others] = await Promise.all([
    lookupAsset(tag),
    prisma.ticket.findMany({
      where: { AND: [ticketScopeWhere(actor), { relatedAsset: { equals: tag, mode: "insensitive" } }, { id: { not: ticketId } }] },
      orderBy: { createdAt: "desc" }, take: 5, select: { id: true, number: true, subject: true, status: { select: { name: true } } },
    }),
  ]);
  if (!r.provider && others.length === 0) return null;
  const a = r.asset;
  const row = (k: string, v: string | null | undefined) => (v ? <><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></> : null);
  return (
    <Card data-testid="asset-card">
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><HardDrive className="size-4" /> Asset {tag}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {r.error && <p className="text-xs text-destructive">Asset lookup failed: {r.error}</p>}
        {r.provider && !a && !r.error && <p className="text-xs text-muted-foreground">Not found in the asset system.</p>}
        {a && (
          <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1">
            {row("Name", a.name)}{row("Model", a.model)}{staff && row("Serial", a.serial)}{row("Status", a.status)}
            {staff && row("Assigned to", a.assignedTo)}{staff && row("Location", a.location)}{row("Warranty until", a.warrantyExpires)}
          </dl>
        )}
        {others.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Other tickets for this asset</p>
            <ul className="space-y-1" data-testid="asset-tickets">
              {others.map((o) => <li key={o.id}><Link className="font-mono text-xs text-primary hover:underline" href={`${ticketBase}/${o.number}`}>{o.number}</Link> <span className="text-xs">{o.subject}</span> <span className="text-xs text-muted-foreground">({o.status.name})</span></li>)}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
