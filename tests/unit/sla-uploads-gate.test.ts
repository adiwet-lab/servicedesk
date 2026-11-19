import { describe, expect, it } from "vitest";
import { addBusinessMinutes, slaState, type BusinessCalendar } from "@/server/domain/sla-calendar";
import { validateUploads, sanitizeFileName } from "@/server/storage/validate";
import { validateEntraClaims } from "@/server/auth/tenant-gate";

const day = [{ start: "08:30", end: "17:30" }];
const cal: BusinessCalendar = { timezone: "Asia/Bangkok", schedule: { "1": day, "2": day, "3": day, "4": day, "5": day }, holidays: ["2026-12-10"] };
// Bangkok is UTC+7 (no DST)
const bkk = (s: string) => new Date(`${s}+07:00`);

describe("business-hours SLA calendar", () => {
  it("adds within the same working day", () => {
    expect(addBusinessMinutes(bkk("2026-11-18T09:00:00"), 120, cal)).toEqual(bkk("2026-11-18T11:00:00"));
  });
  it("rolls over to the next working day", () => {
    expect(addBusinessMinutes(bkk("2026-11-18T17:00:00"), 60, cal)).toEqual(bkk("2026-11-19T09:00:00"));
  });
  it("skips weekends", () => {
    expect(addBusinessMinutes(bkk("2026-11-20T17:00:00"), 60, cal)).toEqual(bkk("2026-11-23T09:00:00")); // Fri → Mon
  });
  it("starts at opening time when created out of hours", () => {
    expect(addBusinessMinutes(bkk("2026-11-21T22:00:00"), 30, cal)).toEqual(bkk("2026-11-23T09:00:00")); // Sat night
  });
  it("skips holidays", () => {
    expect(addBusinessMinutes(bkk("2026-12-09T17:00:00"), 60, cal)).toEqual(bkk("2026-12-11T09:00:00"));
  });
  it("3 business days (27h) from Monday 09:00 → Wednesday end of day", () => {
    expect(addBusinessMinutes(bkk("2026-11-16T08:30:00"), 27 * 60, cal)).toEqual(bkk("2026-11-18T17:30:00"));
  });
  it("sla states", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z"), dueAt = new Date("2026-01-01T10:00:00Z");
    expect(slaState({ createdAt, dueAt, completedAt: null, paused: false, warningPercent: 75, now: new Date("2026-01-01T05:00:00Z") })).toBe("ON_TRACK");
    expect(slaState({ createdAt, dueAt, completedAt: null, paused: false, warningPercent: 75, now: new Date("2026-01-01T08:00:00Z") })).toBe("WARNING");
    expect(slaState({ createdAt, dueAt, completedAt: null, paused: false, warningPercent: 75, now: new Date("2026-01-01T11:00:00Z") })).toBe("BREACHED");
    expect(slaState({ createdAt, dueAt, completedAt: null, paused: true, warningPercent: 75 })).toBe("PAUSED");
    expect(slaState({ createdAt, dueAt, completedAt: new Date("2026-01-01T09:00:00Z"), paused: false, warningPercent: 75 })).toBe("MET");
    expect(slaState({ createdAt, dueAt, completedAt: new Date("2026-01-01T12:00:00Z"), paused: false, warningPercent: 75 })).toBe("MET_LATE");
  });
});

describe("upload validation", () => {
  const rules = { maxFileSizeMb: 1, maxFiles: 2, allowedExtensions: ["png", "pdf", "txt", "log", "docx"] };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const f = (name: string, data: Buffer) => ({ name, size: data.length, data });
  it("accepts valid files", () => {
    const r = validateUploads([f("shot.PNG", png), f("err.log", Buffer.from("ERROR 42\n"))], rules);
    expect("ok" in r && r.files.map((x) => x.mime)).toEqual(["image/png", "text/plain"]);
  });
  it("rejects disallowed extensions", () => expect(validateUploads([f("run.exe", png)], rules)).toHaveProperty("error"));
  it("rejects spoofed content", () => expect(validateUploads([f("doc.pdf", Buffer.from("MZ\x90\x00 not a pdf"))], rules)).toHaveProperty("error"));
  it("rejects HTML disguised as text", () => expect(validateUploads([f("a.txt", Buffer.from("<html><script>alert(1)</script>"))], rules)).toHaveProperty("error"));
  it("rejects oversize", () => expect(validateUploads([f("big.txt", Buffer.alloc(2 * 1024 * 1024, 65))], rules)).toHaveProperty("error"));
  it("rejects too many files", () => expect(validateUploads([f("a.txt", Buffer.from("a")), f("b.txt", Buffer.from("b")), f("c.txt", Buffer.from("c"))], rules)).toHaveProperty("error"));
  it("sanitizes path traversal in names", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("..\\..\\win.ini")).toBe("win.ini");
    expect(sanitizeFileName("a<b>.txt")).toBe("a_b_.txt");
  });
});

describe("Entra claims gate", () => {
  const tid = "11111111-1111-4111-8111-111111111111";
  const oid = "99999999-9999-4999-8999-999999999999";
  it("accepts well-formed claims with matching issuer", () => {
    expect(validateEntraClaims({ tid, oid, iss: `https://login.microsoftonline.com/${tid}/v2.0`, email: "A@B.com" })).toMatchObject({ ok: true, tid, oid, email: "a@b.com" });
  });
  it("rejects issuer from another tenant", () => {
    expect(validateEntraClaims({ tid, oid, iss: "https://login.microsoftonline.com/22222222-2222-4222-8222-222222222222/v2.0" })).toEqual({ ok: false, reason: "issuer_mismatch" });
  });
  it("rejects missing / malformed tid or oid", () => {
    expect(validateEntraClaims({ oid, iss: "x" })).toEqual({ ok: false, reason: "missing_claims" });
    expect(validateEntraClaims({ tid: "contoso.com", oid, iss: "x" })).toEqual({ ok: false, reason: "missing_claims" });
  });
  it("rejects the generic common/organizations issuer", () => {
    expect(validateEntraClaims({ tid, oid, iss: "https://login.microsoftonline.com/common/v2.0" })).toEqual({ ok: false, reason: "issuer_mismatch" });
  });
});
