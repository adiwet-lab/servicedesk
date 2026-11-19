import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, generateApiToken, hashApiToken, maskUrl, pseudonym, safeEqualHex } from "@/server/integrations/crypto";
import { assertOutboundUrl, TEAMS_WEBHOOK_HOSTS } from "@/server/integrations/ssrf";
import { buildAdaptiveCard } from "@/server/integrations/teams";
import { backoffMs, isPermanent } from "@/server/integrations/outbox";
import { HttpError } from "@/server/integrations/http";
import { pick } from "@/server/integrations/assets";
import { parsePaging } from "@/server/integrations/bi";

beforeAll(() => {
  process.env.INTEGRATIONS_KEY = Buffer.alloc(32, 9).toString("base64");
  delete process.env.INTEGRATIONS_ALLOW_LOOPBACK;
  delete process.env.INTEGRATIONS_ALLOWED_HOSTS;
});

describe("secret encryption (AES-256-GCM)", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("https://contoso.webhook.office.com/x");
    const b = encryptSecret("https://contoso.webhook.office.com/x");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("https://contoso.webhook.office.com/x");
  });
  it("detects tampering and wrong keys", () => {
    const box = encryptSecret("secret-value");
    const parts = box.split(".");
    const flipped = Buffer.from(parts[3]!, "base64url"); flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptSecret([parts[0], parts[1], parts[2], flipped.toString("base64url")].join("."))).toThrow();
    process.env.INTEGRATIONS_KEY = Buffer.alloc(32, 1).toString("base64");
    expect(() => decryptSecret(box)).toThrow();
    process.env.INTEGRATIONS_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(() => decryptSecret("v0.x.y.z")).toThrow(/format/);
  });
  it("rejects a wrongly sized key", () => {
    process.env.INTEGRATIONS_KEY = Buffer.alloc(16).toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
    process.env.INTEGRATIONS_KEY = Buffer.alloc(32, 9).toString("base64");
  });
  it("masks URLs to scheme + host", () => {
    expect(maskUrl("https://contoso.webhook.office.com/webhookb2/abc/IncomingWebhook/def")).toBe("https://contoso.webhook.office.com/…");
  });
});

describe("API tokens and pseudonyms", () => {
  it("tokens are random, prefixed and stored as SHA-256 only", () => {
    const t = generateApiToken();
    expect(t).toMatch(/^sdbi_[A-Za-z0-9_-]{43}$/);
    expect(generateApiToken()).not.toBe(t);
    expect(hashApiToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(safeEqualHex(hashApiToken(t), hashApiToken(t))).toBe(true);
    expect(safeEqualHex(hashApiToken(t), hashApiToken(t + "x"))).toBe(false);
  });
  it("pseudonyms are stable, distinct and not the raw ID", () => {
    expect(pseudonym("user-1")).toBe(pseudonym("user-1"));
    expect(pseudonym("user-1")).not.toBe(pseudonym("user-2"));
    expect(pseudonym("user-1")).not.toContain("user-1");
    expect(pseudonym(null)).toBeNull();
  });
});

describe("SSRF guard", () => {
  const ok = (u: string) => assertOutboundUrl(u, TEAMS_WEBHOOK_HOSTS).hostname;
  it("accepts Microsoft webhook hosts over https", () => {
    expect(ok("https://contoso.webhook.office.com/webhookb2/x")).toBe("contoso.webhook.office.com");
    expect(ok("https://prod-12.westeurope.logic.azure.com:443/workflows/x")).toBe("prod-12.westeurope.logic.azure.com");
  });
  it.each([
    ["http://contoso.webhook.office.com/x", /https/],
    ["https://user:pw@contoso.webhook.office.com/x", /credentials/],
    ["https://contoso.webhook.office.com:8443/x", /port/],
    ["https://10.0.0.5/x", /IP addresses/],
    ["https://[::1]/x", /IP addresses/],
    ["https://2130706433/x", /IP addresses/],
    ["https://webhook.office.com.evil.example/x", /allow-list/],
    ["https://evilwebhook.office.com/x", /allow-list/],
    ["https://webhook.office.com/x", /allow-list/], // suffix rule requires a subdomain
    ["https://localhost/x", /host name|allow-list/],
    ["http://127.0.0.1:9999/x", /https/],
    ["javascript:alert(1)", /https|Invalid/],
    ["not a url", /Invalid/],
  ])("rejects %s", (u, err) => expect(() => ok(u)).toThrow(err));
  it("loopback is only allowed when explicitly enabled outside production", () => {
    process.env.INTEGRATIONS_ALLOW_LOOPBACK = "true";
    expect(ok("http://127.0.0.1:9999/x")).toBe("127.0.0.1");
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(() => ok("http://127.0.0.1:9999/x")).toThrow();
    (process.env as Record<string, string>).NODE_ENV = prev ?? "test";
    delete process.env.INTEGRATIONS_ALLOW_LOOPBACK;
  });
  it("INTEGRATIONS_ALLOWED_HOSTS adds exact hosts and suffixes", () => {
    process.env.INTEGRATIONS_ALLOWED_HOSTS = "assets.contoso.example, .corp.contoso.example";
    expect(assertOutboundUrl("https://assets.contoso.example/api", []).hostname).toBe("assets.contoso.example");
    expect(assertOutboundUrl("https://snipe.corp.contoso.example/api", []).hostname).toBe("snipe.corp.contoso.example");
    expect(() => assertOutboundUrl("https://assets.contoso.example.evil.example/api", [])).toThrow(/allow-list/);
    delete process.env.INTEGRATIONS_ALLOWED_HOSTS;
  });
});

describe("Teams cards and outbox policy", () => {
  it("builds an Adaptive Card 1.4 message without empty facts", () => {
    const m = buildAdaptiveCard({ title: "New ticket", subtitle: "IT-1 · Printer", facts: [["Team", "IT"], ["Agent", null]], url: "https://sd.example/admin/tickets/IT-1", tone: "accent" });
    const card = m.attachments[0]!.content as { version: string; body: { type: string; facts?: unknown[] }[]; actions?: unknown[] };
    expect(m.type).toBe("message");
    expect(m.attachments[0]!.contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(card.version).toBe("1.4");
    expect(card.body.find((b) => b.type === "FactSet")!.facts).toEqual([{ title: "Team", value: "IT" }]);
    expect(card.actions).toHaveLength(1);
  });
  it("backs off exponentially, honours Retry-After, caps at one hour", () => {
    expect([1, 2, 3, 4].map((a) => backoffMs(a, null))).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(backoffMs(10, null)).toBe(3_600_000);
    expect(backoffMs(1, 5000)).toBe(5000);
    expect(backoffMs(1, 10 * 3_600_000)).toBe(3_600_000);
  });
  it("treats 4xx (except 408/429) and policy errors as permanent", () => {
    expect(isPermanent(new HttpError("x", 400))).toBe(true);
    expect(isPermanent(new HttpError("x", 404))).toBe(true);
    expect(isPermanent(new HttpError("x", 429))).toBe(false);
    expect(isPermanent(new HttpError("x", 500))).toBe(false);
    expect(isPermanent(new HttpError("x", 0))).toBe(false);
    expect(isPermanent(new Error('Host "x" is not on the integration allow-list.'))).toBe(true);
  });
});

describe("asset field mapping and BI paging", () => {
  it("reads dot-paths safely", () => {
    const j = { asset_tag: "A1", model: { name: "T14" }, n: 0, list: [{ s: "x" }], obj: { a: 1 } };
    expect(pick(j, "asset_tag")).toBe("A1");
    expect(pick(j, "model.name")).toBe("T14");
    expect(pick(j, "list.0.s")).toBe("x");
    expect(pick(j, "n")).toBe("0");
    expect(pick(j, "obj")).toBeNull();
    expect(pick(j, "missing.deep")).toBeNull();
  });
  it("clamps $top/$skip and validates modifiedSince", () => {
    expect(parsePaging(new URLSearchParams("$top=99999&$skip=-5"))).toMatchObject({ top: 5000, skip: 0, modifiedSince: null });
    expect(parsePaging(new URLSearchParams("")).top).toBe(1000);
    expect(parsePaging(new URLSearchParams("modifiedSince=2026-01-01T00:00:00Z")).modifiedSince?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(() => parsePaging(new URLSearchParams("modifiedSince=yesterday"))).toThrow(/ISO-8601/);
  });
});
