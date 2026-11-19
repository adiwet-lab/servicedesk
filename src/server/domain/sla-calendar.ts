/**
 * Business-hours calendar arithmetic, timezone-aware via Intl (no external deps).
 * Used to compute SLA due dates. Phase 4 builds pause/resume on top of this.
 */
export type WeeklySchedule = Record<string, { start: string; end: string }[]>; // "1".."7" (ISO weekday)

export interface BusinessCalendar {
  timezone: string;
  schedule: WeeklySchedule;
  /** Holiday dates as "YYYY-MM-DD" in the calendar's timezone. */
  holidays: Set<string> | string[];
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function zonedParts(date: Date, tz: string) {
  const parts = Object.fromEntries(dtf(tz).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    weekday: WEEKDAY[parts.weekday as string] ?? 1,
  };
}

/** Offset (ms) of tz from UTC at the given instant. */
function tzOffset(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in tz to a UTC Date. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - tzOffset(new Date(guess), tz);
  ts = guess - tzOffset(new Date(ts), tz); // second pass handles DST edges
  return new Date(ts);
}

const pad = (n: number) => String(n).padStart(2, "0");
const parseHm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return { h: h ?? 0, m: m ?? 0 };
};

/** Adds `minutes` of business time to `start`. */
export function addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date {
  if (minutes <= 0) return new Date(start);
  const holidays = cal.holidays instanceof Set ? cal.holidays : new Set(cal.holidays);
  let remaining = minutes * 60_000;
  let cursor = start.getTime();
  const p0 = zonedParts(start, cal.timezone);
  // Iterate calendar days in the business timezone.
  let day = new Date(Date.UTC(p0.year, p0.month - 1, p0.day));
  for (let i = 0; i < 730; i++) {
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const isoWeekday = ((day.getUTCDay() + 6) % 7) + 1;
    const key = `${y}-${pad(m)}-${pad(d)}`;
    const windows = holidays.has(key) ? [] : (cal.schedule[String(isoWeekday)] ?? []);
    for (const w of windows) {
      const s = parseHm(w.start), e = parseHm(w.end);
      const ws = zonedToUtc(y, m, d, s.h, s.m, cal.timezone).getTime();
      const we = zonedToUtc(y, m, d, e.h, e.m, cal.timezone).getTime();
      const segStart = Math.max(ws, cursor);
      if (segStart >= we) continue;
      const avail = we - segStart;
      if (remaining <= avail) return new Date(segStart + remaining);
      remaining -= avail;
      cursor = we;
    }
    day = new Date(day.getTime() + 86_400_000);
  }
  throw new Error("Business calendar has no working time in the next two years.");
}

export function addMinutes(start: Date, minutes: number): Date {
  return new Date(start.getTime() + minutes * 60_000);
}

export type SlaState = "ON_TRACK" | "WARNING" | "BREACHED" | "MET" | "MET_LATE" | "PAUSED" | "NONE";

/** Simple wall-clock SLA state for list display (Phase 4 adds pause-aware business-time tracking). */
export function slaState(args: {
  createdAt: Date; dueAt: Date | null; completedAt: Date | null; paused: boolean; warningPercent: number; now?: Date;
}): SlaState {
  const { createdAt, dueAt, completedAt } = args;
  if (!dueAt) return "NONE";
  if (completedAt) return completedAt <= dueAt ? "MET" : "MET_LATE";
  if (args.paused) return "PAUSED";
  const now = (args.now ?? new Date()).getTime();
  if (now > dueAt.getTime()) return "BREACHED";
  const total = dueAt.getTime() - createdAt.getTime();
  const elapsed = now - createdAt.getTime();
  return total > 0 && elapsed / total >= args.warningPercent / 100 ? "WARNING" : "ON_TRACK";
}
