import { ColorBadge, Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: { name: string; color: string } }) {
  return <ColorBadge color={status.color}>{status.name}</ColorBadge>;
}

export function PriorityBadge({ priority }: { priority: { code: string; name: string; color: string } }) {
  return <ColorBadge color={priority.color}>{priority.code} · {priority.name}</ColorBadge>;
}

type SlaListState = "ON_TRACK" | "WARNING" | "BREACHED" | "MET" | "MET_LATE" | "PAUSED" | "NONE";
const SLA_LABEL: Record<SlaListState, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "outline" }> = {
  ON_TRACK: { label: "On Track", variant: "success" },
  WARNING: { label: "Warning", variant: "warning" },
  BREACHED: { label: "Breached", variant: "destructive" },
  MET: { label: "Within SLA", variant: "success" },
  MET_LATE: { label: "Completed Late", variant: "destructive" },
  PAUSED: { label: "Paused", variant: "secondary" },
  NONE: { label: "—", variant: "outline" },
};

/**
 * List-level SLA state from what the SLA job records (breach flags, WARNING events,
 * pause marker). The ticket detail page evaluates the clocks exactly in business time.
 */
export function listSlaState(t: {
  resolutionDueAt: Date | null; resolvedAt: Date | null; slaPausedAt: Date | null; responseBreached: boolean; resolutionBreached: boolean;
  slaEvents?: { clock: string }[]; status?: { kind: string };
}, now = new Date()): SlaListState {
  if (!t.resolutionDueAt) return "NONE";
  if (t.resolvedAt) return t.resolutionBreached ? "MET_LATE" : "MET";
  if (t.resolutionBreached || t.responseBreached) return "BREACHED";
  if (t.slaPausedAt) return "PAUSED";
  if (t.resolutionDueAt < now) return "BREACHED";
  if (t.slaEvents?.length) return "WARNING";
  return "ON_TRACK";
}

export function SlaBadge({ ticket }: { ticket: Parameters<typeof listSlaState>[0]; warningPercent?: number }) {
  const st = listSlaState(ticket);
  const { label, variant } = SLA_LABEL[st];
  if (st === "NONE") return <span className="text-muted-foreground">—</span>;
  return <Badge variant={variant}>{label}</Badge>;
}
