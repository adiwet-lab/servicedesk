import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../messages/en.json";
import th from "../../messages/th.json";
import { resolveLocale } from "@/i18n/config";
import { ln, pickLang } from "@/lib/localized";
import { makeFormat } from "@/lib/format";
import { renderNotification } from "@/i18n/notifications";
import { translateServerText, translateFieldErrors } from "@/i18n/server-text-translate";
import { crudTranslator } from "@/server/services/admin/crud";
import { periodLabel } from "@/server/domain/analytics";
import { scanAll, scanFile } from "../../scripts/check-i18n";

type Tree = { [k: string]: string | Tree };
const flat = (o: Tree, p = ""): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => (typeof v === "string" ? { ...acc, [p + k]: v } : { ...acc, ...flat(v, `${p}${k}.`) }), {});
const EN = flat(en as Tree);
const TH = flat(th as Tree);
/** Namespaces translated by English lookup / simple {name} substitution, not by ICU formatting. */
const RAW = /^(srv|srvTpl|crud|crudMsg|analytics)\./;
/** Top-level ICU arguments of a message ("{n, plural, …}" counts as n). */
const args = (m: string) => new Set([...m.matchAll(/\{(\w+)\s*[,}]/g)].map((x) => x[1]!));

describe("message catalogs", () => {
  it("Thai and English have exactly the same keys", () => {
    expect(Object.keys(TH).filter((k) => !(k in EN))).toEqual([]);
    expect(Object.keys(EN).filter((k) => !(k in TH))).toEqual([]);
  });

  it("no message is empty", () => {
    expect(Object.entries({ ...EN, ...TH }).filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });

  it("both languages use the same placeholders (Thai notifications may use the …Th variant)", () => {
    const bad = Object.keys(EN).filter((k) => {
      const e = args(EN[k]!), t = args(TH[k]!);
      const norm = (s: Set<string>) => [...s].map((x) => x.replace(/Th$/, "")).sort().join(",");
      return norm(e) !== norm(t);
    });
    expect(bad).toEqual([]);
  });

  it("every ICU message formats in both languages", () => {
    for (const [locale, messages] of [["en", en], ["th", th]] as const) {
      const t = createTranslator({ locale, messages: messages as Tree, onError: (e) => { throw e; } });
      const all = locale === "en" ? EN : TH;
      for (const [key, msg] of Object.entries(all)) {
        if (RAW.test(key)) continue;
        const values = Object.fromEntries([...args(msg)].map((a) => [a, a === "n" ? 2 : "x"]));
        const rich = Object.fromEntries([...msg.matchAll(/<(\w+)>/g)].map((m) => [m[1]!, (c: unknown) => c]));
        const out = /<\w+>/.test(msg) ? t.rich(key as never, { ...values, ...rich } as never) : t(key as never, values as never);
        expect(out, `${locale}:${key}`).toBeTruthy();
      }
    }
  });
});

describe("locale helpers", () => {
  it("resolves user preference → cookie → Thai", () => {
    expect(resolveLocale("en", "th")).toBe("en");
    expect(resolveLocale(null, "en")).toBe("en");
    expect(resolveLocale(undefined, "fr")).toBe("th");
    expect(resolveLocale("xx", undefined)).toBe("th");
  });

  it("uses the Thai name when present and falls back to English", () => {
    expect(ln({ name: "Printer", nameTh: "เครื่องพิมพ์" }, "th")).toBe("เครื่องพิมพ์");
    expect(ln({ name: "Printer", nameTh: "เครื่องพิมพ์" }, "en")).toBe("Printer");
    expect(ln({ name: "Printer", nameTh: null }, "th")).toBe("Printer");
    expect(ln({ name: "Printer", nameTh: "  " }, "th")).toBe("Printer");
    expect(pickLang("Title", "ชื่อ", "th")).toBe("ชื่อ");
    expect(pickLang("", "ชื่อ", "en")).toBe("ชื่อ");
    expect(pickLang("Title", null, "th")).toBe("Title");
  });

  it("formats dates with the Buddhist year in Thai and en-GB in English (Asia/Bangkok)", () => {
    const d = new Date("2026-11-25T03:30:00Z"); // 10:30 in Bangkok
    expect(makeFormat("th").date(d)).toContain("2569");
    expect(makeFormat("en").date(d)).toContain("2026");
    expect(makeFormat("en").dateTime(d)).toContain("10:30");
    expect(makeFormat("th").duration(61)).toMatch(/ชม\./);
    expect(makeFormat("en").duration(61)).toMatch(/1h/);
    expect(periodLabel("2026-11", "month", "th")).toMatch(/69/);
    expect(periodLabel("2026-11-02", "week", "en")).toMatch(/^wk /);
  });
});

describe("notifications", () => {
  const tFor = (locale: "en" | "th") => createTranslator({ locale, messages: (locale === "en" ? en : th) as Tree, namespace: "notify" as never });
  it("renders stored key + params in the viewer's language", () => {
    const n = { key: "statusChanged", params: { number: "IT-1", from: "New", to: "Resolved", fromTh: "ใหม่", toTh: "แก้ไขแล้ว", text: "Fixed" }, title: "stored", body: null };
    expect(renderNotification(n, tFor("en") as never).title).toBe("IT-1: New → Resolved");
    expect(renderNotification(n, tFor("th") as never)).toEqual({ title: "IT-1: ใหม่ → แก้ไขแล้ว", body: "Fixed" });
  });
  it("keeps the stored text of notifications created before i18n", () => {
    expect(renderNotification({ key: null, params: null, title: "Old title", body: "Old body" }, tFor("th") as never)).toEqual({ title: "Old title", body: "Old body" });
  });
});

describe("server message translation", () => {
  it("translates known messages, templated messages and validation keys; unknown text stays English", () => {
    expect(translateServerText("Ticket not found or you do not have access.", "th")).toBe("ไม่พบทิกเก็ตหรือคุณไม่มีสิทธิ์เข้าถึง");
    expect(translateServerText("Ticket not found or you do not have access.", "en")).toBe("Ticket not found or you do not have access.");
    expect(translateServerText('You cannot grant role "Agent" because it includes permissions you do not hold.', "th")).toContain('"Agent"');
    expect(translateServerText("SLA breached (response): IT-1", "th")).toBe("เกิน SLA (การตอบรับ): IT-1");
    expect(translateServerText("String must contain at least 5 character(s)", "th")).toBe("ต้องมีอย่างน้อย 5 ตัวอักษร");
    expect(translateServerText("validation.kbTitleMin", "en")).toBe("Title must be at least 5 characters.");
    expect(translateServerText("Something new", "th")).toBe("Something new");
    expect(translateFieldErrors({ subject: "Subject must be at least 5 characters" }, "th")).toEqual({ subject: "หัวข้อต้องมีอย่างน้อย 5 ตัวอักษร" });
  });

  it("translates admin CRUD labels by their English text", () => {
    const tr = crudTranslator("th");
    expect(tr("Name (TH)")).toBe("ชื่อ (ไทย)");
    expect(tr("Ticket Statuses")).toBe("สถานะทิกเก็ต");
    expect(tr("Contoso Retail")).toBe("Contoso Retail");
    expect(crudTranslator("en")("Name (TH)")).toBe("Name (TH)");
  });
});

describe("untranslated text check (pnpm lint:i18n)", () => {
  it("flags JSX text and user-facing attributes, ignores code and symbols", () => {
    const src = `export function X() { return <div title="Hello there" data-testid="ok-id"><p>Plain English</p>{"·"}<code>v1</code>{t("k")}</div>; }`;
    const found = scanFile("x.tsx", src).map((f) => f.text);
    expect(found).toContain("Hello there");
    expect(found).toContain("Plain English");
    expect(found).not.toContain("ok-id");
  });

  it("finds no untranslated literals in the app", () => {
    expect(scanAll()).toEqual([]);
  });
});
