import { useLocale, useTranslations } from "next-intl";
import { ColorBadge, Badge } from "@/components/ui/badge";
import { ln } from "@/lib/localized";
import type { Locale } from "@/i18n/config";

export function StatusBadge({ status }: { status: { name: string; nameTh?: string | null; color: string } }) {
  const locale = useLocale() as Locale;
  return <ColorBadge color={status.color}>{ln(status, locale)}</ColorBadge>;
}

export function PriorityBadge({ priority }: { priority: { code: string; name: string; nameTh?: string | null; color: string } }) {
  const locale = useLocale() as Locale;
  return <ColorBadge color={priority.color}>{priority.code} · {ln(priority, locale)}</ColorBadge>;
}

type SlaListState = "ON_TRACK" | "WARNING" | "BREACHED" | "MET" | "MET_LATE" | "PAUSED" | "NONE";
const SLA_VARIANT: Record<SlaListState, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  ON_TRACK: "success", WARNING: "warning", BREACHED: "destructive", MET: "success", MET_LATE: "destructive", PAUSED: "secondary", NONE: "outline",
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
  const t = useTranslations("sla.state");
  const st = listSlaState(ticket);
  if (st === "NONE") return <span className="text-muted-foreground">—</span>;
  return <Badge variant={SLA_VARIANT[st]}>{t(st)}</Badge>;
}
