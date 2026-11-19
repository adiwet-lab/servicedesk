import { describe, expect, it } from "vitest";
import { addBusinessMinutes, type BusinessCalendar } from "@/server/domain/sla-calendar";
import {
  businessMinutesBetween, clockDueAt, dailyWorkingMinutes, dueEscalations, evaluateClock, isPausedStatus, type ClockInput,
} from "@/server/domain/sla-engine";

const day = [{ start: "08:30", end: "17:30" }];
const cal: BusinessCalendar = { timezone: "Asia/Bangkok", schedule: { "1": day, "2": day, "3": day, "4": day, "5": day }, holidays: ["2026-12-10"] };
const split: BusinessCalendar = { timezone: "Asia/Bangkok", schedule: { "1": [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }] }, holidays: [] };
const bkk = (s: string) => new Date(`${s}+07:00`);

describe("businessMinutesBetween", () => {
  it("same day inside working hours", () => expect(businessMinutesBetween(bkk("2026-11-18T09:00:00"), bkk("2026-11-18T11:30:00"), cal)).toBe(150));
  it("clips to working windows", () => expect(businessMinutesBetween(bkk("2026-11-18T07:00:00"), bkk("2026-11-18T20:00:00"), cal)).toBe(540));
  it("overnight", () => expect(businessMinutesBetween(bkk("2026-11-18T17:00:00"), bkk("2026-11-19T09:00:00"), cal)).toBe(60));
  it("skips weekends", () => expect(businessMinutesBetween(bkk("2026-11-20T17:00:00"), bkk("2026-11-23T09:00:00"), cal)).toBe(60));
  it("skips holidays", () => expect(businessMinutesBetween(bkk("2026-12-09T17:00:00"), bkk("2026-12-11T09:00:00"), cal)).toBe(60));
  it("handles split shifts (lunch break excluded)", () => expect(businessMinutesBetween(bkk("2026-11-16T11:00:00"), bkk("2026-11-16T14:00:00"), split)).toBe(120));
  it("timezone matters: same UTC instant, different calendar", () => {
    const ny: BusinessCalendar = { ...cal, timezone: "America/New_York" };
    // 2026-11-18 14:00Z = 21:00 Bangkok (closed) = 09:00 New York (open)
    const a = new Date("2026-11-18T14:00:00Z"), b = new Date("2026-11-18T15:00:00Z");
    expect(businessMinutesBetween(a, b, cal)).toBe(0);
    expect(businessMinutesBetween(a, b, ny)).toBe(60);
  });
  it("24x7 (no calendar) = wall minutes; reversed range = 0", () => {
    expect(businessMinutesBetween(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-02T00:00:00Z"), null)).toBe(1440);
    expect(businessMinutesBetween(bkk("2026-11-18T12:00:00"), bkk("2026-11-18T10:00:00"), cal)).toBe(0);
  });
  it("is the inverse of addBusinessMinutes", () => {
    const start = bkk("2026-11-18T16:10:00");
    for (const m of [1, 50, 540, 1000, 27 * 60, 5 * 540]) {
      expect(businessMinutesBetween(start, addBusinessMinutes(start, m, cal), cal)).toBe(m);
    }
  });
  it("daily working minutes", () => {
    expect(dailyWorkingMinutes(cal)).toBe(540);
    expect(dailyWorkingMinutes(split)).toBe(480);
    expect(dailyWorkingMinutes(null)).toBe(1440);
  });
});

describe("evaluateClock", () => {
  const created = new Date("2026-11-18T00:00:00Z");
  const base: ClockInput = { createdAt: created, targetMinutes: 240, pausedBusinessMinutes: 0, pausedAt: null, metAt: null, warningPercent: 75, calendar: null };
  const at = (min: number) => new Date(created.getTime() + min * 60_000);

  it("on track → warning → breached", () => {
    expect(evaluateClock(base, at(60))).toMatchObject({ state: "ON_TRACK", remainingMinutes: 180, elapsedPercent: 25 });
    expect(evaluateClock(base, at(180))).toMatchObject({ state: "WARNING", elapsedPercent: 75 });
    expect(evaluateClock(base, at(241))).toMatchObject({ state: "BREACHED", remainingMinutes: -1 });
    expect(evaluateClock(base, at(10)).dueAt).toEqual(at(240));
  });
  it("met / met late", () => {
    expect(evaluateClock({ ...base, metAt: at(200) }, at(1000))).toMatchObject({ state: "MET", remainingMinutes: 40 });
    expect(evaluateClock({ ...base, metAt: at(300) }, at(1000))).toMatchObject({ state: "MET_LATE", remainingMinutes: -60 });
  });
  it("paused clock freezes consumption and pushes the due date", () => {
    const paused = { ...base, pausedAt: at(100) };
    expect(evaluateClock(paused, at(1000))).toMatchObject({ state: "PAUSED", remainingMinutes: 140 });
    expect(clockDueAt(paused, at(1000))).toEqual(at(240 + 900));
  });
  it("resume: ledger arithmetic equals adding the paused time", () => {
    // paused 100→160 (60 min) then running
    const resumed = { ...base, pausedBusinessMinutes: 60 };
    expect(evaluateClock(resumed, at(200))).toMatchObject({ state: "ON_TRACK", remainingMinutes: 100 });
    expect(evaluateClock(resumed, at(200)).dueAt).toEqual(at(300));
  });
  it("breach while paused stays breached", () => {
    expect(evaluateClock({ ...base, pausedAt: at(250) }, at(400)).state).toBe("BREACHED");
  });
  it("no target → NONE", () => expect(evaluateClock({ ...base, targetMinutes: null }, at(1)).state).toBe("NONE"));
  it("business-hours clock does not run outside working hours", () => {
    const c = { ...base, createdAt: bkk("2026-11-20T16:30:00"), calendar: cal, targetMinutes: 120 }; // Friday 16:30
    expect(evaluateClock(c, bkk("2026-11-22T12:00:00"))).toMatchObject({ state: "ON_TRACK", remainingMinutes: 60, elapsedPercent: 50 }); // Sunday: only Friday 16:30–17:30 used
    expect(evaluateClock(c, bkk("2026-11-23T09:30:00"))).toMatchObject({ state: "BREACHED" }); // Monday 09:30 = due
  });
});

describe("pause conditions & escalation selection", () => {
  it("profile list wins over status flags", () => {
    expect(isPausedStatus("WAITING_USER", false, ["WAITING_USER"])).toBe(true);
    expect(isPausedStatus("ON_HOLD", true, ["WAITING_USER"])).toBe(false);
    expect(isPausedStatus("ON_HOLD", true, [])).toBe(true);
    expect(isPausedStatus("IN_PROGRESS", false, null)).toBe(false);
  });
  it("selects due, unfired, active rules in threshold order", () => {
    const rules = [
      { id: "r100", clock: "RESOLUTION" as const, atPercent: 100, isActive: true },
      { id: "r75", clock: "RESOLUTION" as const, atPercent: 75, isActive: true },
      { id: "resp50", clock: "RESPONSE" as const, atPercent: 50, isActive: true },
      { id: "off", clock: "RESOLUTION" as const, atPercent: 10, isActive: false },
    ];
    expect(dueEscalations(rules, { RESPONSE: null, RESOLUTION: 120 }, new Set()).map((r) => r.id)).toEqual(["r75", "r100"]);
    expect(dueEscalations(rules, { RESPONSE: 60, RESOLUTION: 80 }, new Set(["r75"])).map((r) => r.id)).toEqual(["resp50"]);
  });
});
