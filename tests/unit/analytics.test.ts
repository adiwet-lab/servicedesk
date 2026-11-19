import { describe, expect, it } from "vitest";
import {
  ageInDays, agingBucket, agingRange, average, chooseGranularity, compliance, csvEscape, median, periodKey, periodKeys, toCsv,
} from "@/server/domain/analytics";
import { dateWindow, parseAnalyticsFilters } from "@/server/services/analytics";

describe("aging buckets", () => {
  it.each([[0, "0-1"], [1, "0-1"], [2, "2-3"], [3, "2-3"], [4, "4-7"], [7, "4-7"], [8, "8-14"], [14, "8-14"], [15, "15+"], [400, "15+"]])("%i days → %s", (d, k) => {
    expect(agingBucket(d)).toBe(k);
  });
  it("age in whole days", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    expect(ageInDays(new Date("2026-11-18T13:00:00Z"), now)).toBe(0);
    expect(ageInDays(new Date("2026-11-18T11:00:00Z"), now)).toBe(1);
    expect(ageInDays(new Date("2026-11-20T00:00:00Z"), now)).toBe(0);
  });
  it("agingRange is consistent with agingBucket", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    for (const days of [0, 1, 2, 5, 8, 14, 15, 30]) {
      const created = new Date(now.getTime() - days * 86_400_000 - 3600_000);
      const key = agingBucket(ageInDays(created, now));
      const r = agingRange(key, now);
      expect(!r.lte || created <= r.lte).toBe(true);
      expect(!r.gt || created > r.gt).toBe(true);
    }
  });
});

describe("periods", () => {
  it("granularity by range length", () => {
    const d = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000);
    expect(chooseGranularity(d(0), d(30))).toBe("day");
    expect(chooseGranularity(d(0), d(90))).toBe("week");
    expect(chooseGranularity(d(0), d(500))).toBe("month");
  });
  it("ISO week keys start on Monday", () => {
    expect(periodKey(new Date("2026-11-19T10:00:00Z"), "week")).toBe("2026-11-16"); // Thu → Mon
    expect(periodKey(new Date("2026-11-16T00:00:00Z"), "week")).toBe("2026-11-16");
    expect(periodKey(new Date("2026-11-22T23:00:00Z"), "week")).toBe("2026-11-16"); // Sun
    expect(periodKey(new Date("2026-11-19T10:00:00Z"), "month")).toBe("2026-11");
  });
  it("periodKeys has no gaps and includes both ends", () => {
    const keys = periodKeys(new Date("2026-11-01T00:00:00Z"), new Date("2026-11-07T10:00:00Z"), "day");
    expect(keys).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    const weeks = periodKeys(new Date("2026-10-01T00:00:00Z"), new Date("2026-11-19T00:00:00Z"), "week");
    expect(weeks[0]).toBe("2026-09-28");
    expect(weeks.at(-1)).toBe("2026-11-16");
    expect(new Set(weeks).size).toBe(weeks.length);
  });
});

describe("statistics", () => {
  it("compliance handles zero", () => {
    expect(compliance(0, 0)).toBeNull();
    expect(compliance(2, 3)).toBe(66.7);
    expect(compliance(5, 5)).toBe(100);
  });
  it("average / median", () => {
    expect(average([])).toBeNull();
    expect(average([1, 2, 4])).toBe(2);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(3); // (2+3)/2 rounded
  });
});

describe("CSV", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvEscape('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(42)).toBe("42");
  });
  it("neutralises spreadsheet formula injection", () => {
    expect(csvEscape("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvEscape("+1+1")).toBe("'+1+1");
    expect(csvEscape("-2")).toBe("'-2");
    expect(csvEscape("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvEscape("\tcmd")).toBe("'\tcmd");
  });
  it("keeps Thai text and adds a BOM + CRLF", () => {
    const csv = toCsv(["หัวข้อ", "n"], [["เครื่องพิมพ์เสีย", 1]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("เครื่องพิมพ์เสีย,1\r\n");
  });
});

describe("filters", () => {
  it("bad input falls back to safe defaults", () => {
    const f = parseAnalyticsFilters({ range: "forever", from: "2026-13-99'; DROP", team: "x".repeat(80) });
    expect(f.range).toBe("30d");
    expect(f.from).toBeUndefined();
    expect(f.team).toBeUndefined();
  });
  it("date windows", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    expect(dateWindow(parseAnalyticsFilters({ range: "7d" }), now).from.toISOString()).toBe("2026-11-12T12:00:00.000Z");
    expect(dateWindow(parseAnalyticsFilters({ range: "month" }), now).from.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    const c = dateWindow(parseAnalyticsFilters({ range: "custom", from: "2026-10-01", to: "2026-10-31" }), now);
    expect([c.from.toISOString(), c.to.toISOString()]).toEqual(["2026-10-01T00:00:00.000Z", "2026-10-31T23:59:59.999Z"]);
  });
});
