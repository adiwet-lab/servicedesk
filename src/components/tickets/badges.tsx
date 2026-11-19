import { ColorBadge, Badge } from "@/components/ui/badge";
import { slaState, type SlaState } from "@/server/domain/sla-calendar";

export function StatusBadge({ status }: { status: { name: string; color: string } }) {
  return <ColorBadge color={status.color}>{status.name}</ColorBadge>;
}

export function PriorityBadge({ priority }: { priority: { code: string; name: string; color: string } }) {
  return <ColorBadge color={priority.color}>{priority.code} · {priority.name}</ColorBadge>;
}

const SLA_LABEL: Record<SlaState, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "outline" }> = {
  ON_TRACK: { label: "On Track", variant: "success" },
  WARNING: { label: "Warning", variant: "warning" },
  BREACHED: { label: "Breached", variant: "destructive" },
  MET: { label: "Within SLA", variant: "success" },
  MET_LATE: { label: "Completed Late", variant: "destructive" },
  PAUSED: { label: "Paused", variant: "secondary" },
  NONE: { label: "—", variant: "outline" },
};

export function SlaBadge({ ticket, warningPercent = 75 }: {
  ticket: { createdAt: Date; resolutionDueAt: Date | null; resolvedAt: Date | null; slaPausedAt: Date | null };
  warningPercent?: number;
}) {
  const st = slaState({ createdAt: ticket.createdAt, dueAt: ticket.resolutionDueAt, completedAt: ticket.resolvedAt, paused: !!ticket.slaPausedAt, warningPercent });
  const { label, variant } = SLA_LABEL[st];
  if (st === "NONE") return <span className="text-muted-foreground">—</span>;
  return <Badge variant={variant}>{label}</Badge>;
}
