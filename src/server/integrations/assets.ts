import { prisma } from "@/server/db";
import { getSettings, type Settings } from "@/server/services/settings";
import { decryptSecret } from "./crypto";
import { HttpError, httpJson } from "./http";
import { assertOutboundUrl } from "./ssrf";

/** Normalised asset record shown on tickets. */
export interface Asset {
  tag: string; name: string | null; model: string | null; serial: string | null; status: string | null;
  assignedTo: string | null; location: string | null; warrantyExpires: string | null;
}

export interface AssetProvider {
  readonly id: "none" | "demo" | "rest";
  lookup(tag: string): Promise<Asset | null>;
}

export const ASSET_TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/;

// ───────────────────────────── Demo provider ─────────────────────────────

const DEMO: Asset[] = [
  { tag: "POS-BKK01-03", name: "POS terminal 3", model: "Toshiba TCx 810", serial: "TCX810-88231", status: "Deployed", assignedTo: "Bangkok – Siam Store", location: "Sales Floor", warrantyExpires: "2027-03-31" },
  { tag: "POS-BKK01-ALL", name: "Siam store POS fleet", model: "Toshiba TCx 810 (×6)", serial: null, status: "Deployed", assignedTo: "Bangkok – Siam Store", location: "Sales Floor", warrantyExpires: "2027-03-31" },
  { tag: "EDC-BKK01-01", name: "Payment terminal 1", model: "Verifone V400m", serial: "V400M-1029384", status: "Deployed", assignedTo: "Bangkok – Siam Store", location: "Sales Floor", warrantyExpires: "2026-12-31" },
  { tag: "PRN-HQ-F5-02", name: "Finance printer", model: "HP LaserJet M507", serial: "PHB8K22011", status: "Deployed", assignedTo: "Finance", location: "Floor 5", warrantyExpires: "2026-06-30" },
  { tag: "NB-C1001", name: "Emma's notebook", model: "Lenovo ThinkPad T14 Gen 4", serial: "PF4ABC12", status: "Deployed", assignedTo: "Emma Employee", location: "Bangkok – Siam Store", warrantyExpires: "2027-09-30" },
  { tag: "MON-FHQ-0091", name: "Monitor", model: "Dell P2723DE", serial: "CN0ABC1234", status: "Deployed", assignedTo: "Fiona Fabrikam", location: "Fabrikam HQ", warrantyExpires: "2026-01-15" },
];

export const demoProvider: AssetProvider = {
  id: "demo",
  async lookup(tag) { return DEMO.find((a) => a.tag.toLowerCase() === tag.toLowerCase()) ?? null; },
};

// ───────────────────────────── REST provider (Snipe-IT compatible) ─────────────────────────────

/** Reads a dot-path ("model.name", "items.0.serial") from JSON. */
export function pick(obj: unknown, path: string): string | null {
  let cur: unknown = obj;
  for (const part of path.split(".").filter(Boolean)) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  if (cur == null || cur === "") return null;
  return typeof cur === "string" || typeof cur === "number" || typeof cur === "boolean" ? String(cur) : null;
}

export function restProvider(cfg: Settings["integrations.assets"], apiKey: string): AssetProvider {
  return {
    id: "rest",
    async lookup(tag) {
      if (!cfg.baseUrl) throw new Error("Asset system URL is not configured.");
      const base = assertOutboundUrl(cfg.baseUrl, []); // host must be on INTEGRATIONS_ALLOWED_HOSTS
      const url = new URL(cfg.lookupPath.replace("{tag}", encodeURIComponent(tag)), base);
      if (url.origin !== base.origin) throw new Error("Lookup path must stay on the asset system host.");
      let j: unknown;
      try {
        j = await httpJson(url.toString(), { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, timeoutMs: 8_000 });
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return null;
        throw e;
      }
      // Snipe-IT answers 200 {status:"error"} for unknown tags.
      if (j && typeof j === "object" && (j as Record<string, unknown>).status === "error") return null;
      const m = cfg.mapping;
      const found = pick(j, m.tag ?? "asset_tag");
      if (!found) return null;
      return {
        tag: found, name: pick(j, m.name ?? ""), model: pick(j, m.model ?? ""), serial: pick(j, m.serial ?? ""), status: pick(j, m.status ?? ""),
        assignedTo: pick(j, m.assignedTo ?? ""), location: pick(j, m.location ?? ""), warrantyExpires: pick(j, m.warrantyExpires ?? ""),
      };
    },
  };
}

// ───────────────────────────── Facade with short cache ─────────────────────────────

const cache = new Map<string, { at: number; value: Asset | null }>();
const TTL = 5 * 60_000;
export function clearAssetCache() { cache.clear(); }

export async function getAssetProvider(): Promise<AssetProvider | null> {
  const s = await getSettings(prisma);
  const cfg = s["integrations.assets"];
  if (cfg.provider === "none") return null;
  if (cfg.provider === "demo") return demoProvider;
  const key = s["integrations.assets.apiKeyEnc"] ? decryptSecret(s["integrations.assets.apiKeyEnc"]) : "";
  return restProvider(cfg, key);
}

/** Looks up an asset tag; returns { asset } or { error } (lookup failures never break ticket pages). */
export async function lookupAsset(tag: string): Promise<{ provider: string | null; asset: Asset | null; error?: string }> {
  const t = tag.trim();
  if (!ASSET_TAG_RE.test(t)) return { provider: null, asset: null, error: "Invalid asset tag." };
  const p = await getAssetProvider();
  if (!p) return { provider: null, asset: null };
  const k = `${p.id}:${t.toLowerCase()}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return { provider: p.id, asset: hit.value };
  try {
    const asset = await p.lookup(t);
    cache.set(k, { at: Date.now(), value: asset });
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    return { provider: p.id, asset };
  } catch (e) {
    return { provider: p.id, asset: null, error: (e as Error).message.slice(0, 200) };
  }
}
