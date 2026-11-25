import { INTL_LOCALE, type Locale } from "@/i18n/config";

/**
 * Locale-aware display formatting. Thai uses the Buddhist calendar (พ.ศ.) through Intl
 * ("th-TH"); English uses en-GB. Times are shown in Asia/Bangkok.
 */
const TZ = "Asia/Bangkok";
const toDate = (d: Date | string) => (typeof d === "string" ? new Date(d) : d);

export function makeFormat(locale: Locale) {
  const tag = INTL_LOCALE[locale];
  const dt = new Intl.DateTimeFormat(tag, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const d = new Intl.DateTimeFormat(tag, { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
  const time = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const num = new Intl.NumberFormat(tag);
  const u = locale === "th"
    ? { d: " วัน", h: " ชม.", m: " นาที", day: (n: number) => `${n} วัน`, hour: (n: number) => `${n} ชั่วโมง`, min: (n: number) => `${n} นาที` }
    : { d: "d", h: "h", m: "m", day: (n: number) => `${n} day(s)`, hour: (n: number) => `${n} hour(s)`, min: (n: number) => `${n} min` };
  return {
    locale,
    dateTime: (v: Date | string | null | undefined) => (v ? dt.format(toDate(v)) : "—"),
    date: (v: Date | string | null | undefined) => (v ? d.format(toDate(v)) : "—"),
    time: (v: Date | string | null | undefined) => (v ? time.format(toDate(v)) : "—"),
    number: (n: number) => num.format(n),
    /** Ticket aging, e.g. "3d 4h" / "3 วัน 4 ชม.". */
    aging: (from: Date | string, to: Date | string = new Date()) => {
      const mins = Math.max(0, Math.floor((toDate(to).getTime() - toDate(from).getTime()) / 60000));
      const dd = Math.floor(mins / 1440), hh = Math.floor((mins % 1440) / 60), mm = mins % 60;
      if (dd > 0) return `${dd}${u.d} ${hh}${u.h}`;
      if (hh > 0) return `${hh}${u.h} ${mm}${u.m}`;
      return `${mm}${u.m}`;
    },
    /** Compact duration from minutes (sign ignored), e.g. "1d 4h" / "1 วัน 4 ชม.". */
    duration: (minutes: number) => {
      const m = Math.abs(Math.round(minutes));
      const dd = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
      if (dd) return `${dd}${u.d} ${hh}${u.h}`;
      if (hh) return `${hh}${u.h} ${mm}${u.m}`;
      return `${mm}${u.m}`;
    },
    /** SLA targets, e.g. "2 hour(s)" / "2 ชั่วโมง". */
    minutes: (mins: number) => (mins % 1440 === 0 ? u.day(mins / 1440) : mins % 60 === 0 ? u.hour(mins / 60) : u.min(mins)),
    bytes: (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`),
  };
}
export type Formatter = ReturnType<typeof makeFormat>;
