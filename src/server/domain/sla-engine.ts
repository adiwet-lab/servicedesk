/**
 * SLA clock engine (pure). Both clocks (response, resolution) share one pause
 * ledger per ticket:
 *
 *   consumed(now) = businessMinutes(createdAt, pausedAt ?? now) − pausedBusinessMinutes
 *   dueAt         = addBusinessMinutes(createdAt, target + pausedBusinessMinutes)   (while running)
 *   remaining     = target − consumed
 *
 * "Business minutes" use the SLA calendar (working windows, holidays, timezone)
 * or plain wall-clock minutes for 24x7 targets (calendar = null).
 */
import { addBusinessMinutes, addMinutes, zonedParts, zonedToUtc, type BusinessCalendar } from "./sla-calendar";

const pad = (n: number) => String(n).padStart(2, "0");
const parseHm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return { h: h ?? 0, m: m ?? 0 };
};

/** Business minutes between a and b (0 if b <= a). Inverse of addBusinessMinutes. */
export function businessMinutesBetween(a: Date, b: Date, cal: BusinessCalendar | null): number {
  if (b.getTime() <= a.getTime()) return 0;
  if (!cal) return Math.floor((b.getTime() - a.getTime()) / 60_000);
  const holidays = cal.holidays instanceof Set ? cal.holidays : new Set(cal.holidays);
  const start = a.getTime();
  const end = b.getTime();
  const p0 = zonedParts(a, cal.timezone);
  let day = new Date(Date.UTC(p0.year, p0.month - 1, p0.day));
  let total = 0;
  for (let i = 0; i < 3660; i++) {
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const dayStart = zonedToUtc(y, m, d, 0, 0, cal.timezone).getTime();
    if (dayStart >= end) break;
    const isoWeekday = ((day.getUTCDay() + 6) % 7) + 1;
    const windows = holidays.has(`${y}-${pad(m)}-${pad(d)}`) ? [] : (cal.schedule[String(isoWeekday)] ?? []);
    for (const w of windows) {
      const s = parseHm(w.start), e = parseHm(w.end);
      const ws = zonedToUtc(y, m, d, s.h, s.m, cal.timezone).getTime();
      const we = zonedToUtc(y, m, d, e.h, e.m, cal.timezone).getTime();
      const lo = Math.max(ws, start), hi = Math.min(we, end);
      if (hi > lo) total += hi - lo;
    }
    day = new Date(day.getTime() + 86_400_000);
  }
  return Math.floor(total / 60_000);
}

export function addClockMinutes(start: Date, minutes: number, cal: BusinessCalendar | null): Date {
  return cal ? addBusinessMinutes(start, minutes, cal) : addMinutes(start, minutes);
}

/** Working minutes of a typical working day (for "business day" units). */
export function dailyWorkingMinutes(cal: BusinessCalendar | null): number {
  if (!cal) return 24 * 60;
  const perDay = Object.values(cal.schedule).map((ws) =>
    ws.reduce((acc, w) => {
      const s = parseHm(w.start), e = parseHm(w.end);
      return acc + Math.max(0, e.h * 60 + e.m - (s.h * 60 + s.m));
    }, 0),
  ).filter((x) => x > 0);
  return perDay.length ? Math.max(...perDay) : 8 * 60;
}

// ───────────────────────────── Clock evaluation ─────────────────────────────

export type ClockState = "ON_TRACK" | "WARNING" | "BREACHED" | "MET" | "MET_LATE" | "PAUSED" | "NONE";

export const CLOCK_STATE_LABEL: Record<ClockState, string> = {
  ON_TRACK: "On Track", WARNING: "Warning", BREACHED: "Breached", MET: "Completed Within SLA", MET_LATE: "Completed Late", PAUSED: "Paused", NONE: "No SLA",
};

export interface ClockInput {
  createdAt: Date;
  targetMinutes: number | null;
  pausedBusinessMinutes: number;
  /** Ticket-level pause start (pause status or resolved). */
  pausedAt: Date | null;
  /** When this clock was satisfied (first response / resolution). */
  metAt: Date | null;
  warningPercent: number;
  calendar: BusinessCalendar | null;
}

export interface ClockResult {
  state: ClockState;
  dueAt: Date | null;
  /** Negative when overdue. Business minutes (or wall minutes for 24x7). */
  remainingMinutes: number | null;
  elapsedPercent: number | null;
}

/**
 * Due date for the clock given the pause ledger. While paused the due date is
 * not fixed; the value returned assumes the pause ends now.
 */
export function clockDueAt(input: Pick<ClockInput, "createdAt" | "targetMinutes" | "pausedBusinessMinutes" | "pausedAt" | "calendar">, now: Date): Date | null {
  if (input.targetMinutes == null) return null;
  const extraPaused = input.pausedAt ? businessMinutesBetween(input.pausedAt, now, input.calendar) : 0;
  return addClockMinutes(input.createdAt, input.targetMinutes + input.pausedBusinessMinutes + extraPaused, input.calendar);
}

export function evaluateClock(input: ClockInput, now: Date): ClockResult {
  if (input.targetMinutes == null || input.targetMinutes <= 0) return { state: "NONE", dueAt: null, remainingMinutes: null, elapsedPercent: null };
  const target = input.targetMinutes;
  const consumedAt = (t: Date) => businessMinutesBetween(input.createdAt, t, input.calendar) - input.pausedBusinessMinutes;

  if (input.metAt) {
    // Measured at the moment the clock was met (pause ledger at that time is what we have).
    const consumed = consumedAt(input.metAt);
    const due = addClockMinutes(input.createdAt, target + input.pausedBusinessMinutes, input.calendar);
    return { state: consumed <= target ? "MET" : "MET_LATE", dueAt: due, remainingMinutes: target - consumed, elapsedPercent: Math.round((consumed / target) * 100) };
  }
  const effectiveNow = input.pausedAt && input.pausedAt < now ? input.pausedAt : now;
  const consumed = Math.max(0, consumedAt(effectiveNow));
  const remaining = target - consumed;
  const pct = Math.round((consumed / target) * 100);
  const dueAt = clockDueAt(input, now);
  if (remaining <= 0) return { state: "BREACHED", dueAt, remainingMinutes: remaining, elapsedPercent: pct };
  if (input.pausedAt) return { state: "PAUSED", dueAt, remainingMinutes: remaining, elapsedPercent: pct };
  return { state: pct >= input.warningPercent ? "WARNING" : "ON_TRACK", dueAt, remainingMinutes: remaining, elapsedPercent: pct };
}

/** Pause conditions: profile list wins when configured, otherwise the status's own flag. */
export function isPausedStatus(statusCode: string, statusPausesSla: boolean, profilePauseCodes: unknown): boolean {
  const codes = Array.isArray(profilePauseCodes) ? (profilePauseCodes as unknown[]).filter((c): c is string => typeof c === "string") : [];
  return codes.length > 0 ? codes.includes(statusCode) : statusPausesSla;
}

// ───────────────────────────── Escalation ─────────────────────────────

export interface EscalationRuleLite {
  id: string;
  clock: "RESPONSE" | "RESOLUTION";
  atPercent: number;
  isActive: boolean;
}

/** Rules whose threshold is reached for an open (not met / not paused) clock and that have not fired yet. */
export function dueEscalations<R extends EscalationRuleLite>(
  rules: R[],
  percents: { RESPONSE: number | null; RESOLUTION: number | null },
  alreadyFired: Set<string>,
): R[] {
  return rules
    .filter((r) => r.isActive && !alreadyFired.has(r.id))
    .filter((r) => {
      const pct = percents[r.clock];
      return pct != null && pct >= r.atPercent;
    })
    .sort((a, b) => a.atPercent - b.atPercent);
}

/** "3h 20m", "2d 1h" style formatting of a minute count. */
export function formatClockMinutes(mins: number): string {
  const m = Math.abs(Math.round(mins));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), r = m % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${r}m`;
  return `${r}m`;
}
