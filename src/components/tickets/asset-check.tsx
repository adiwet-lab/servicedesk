"use client";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { lookupAssetAction } from "@/server/actions/integrations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Related-asset input with an optional lookup against the asset system. */
export function AssetInput({ required, invalid }: { required: boolean; invalid: boolean }) {
  const t = useTranslations("assetCheck");
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input id="relatedAsset" name="relatedAsset" maxLength={100} required={required} aria-invalid={invalid} value={value}
          onChange={(e) => { setValue(e.target.value); setMsg(null); }} />
        <Button type="button" variant="outline" size="sm" disabled={busy || !value.trim()} data-testid="asset-check" onClick={() => start(async () => {
          const r = await lookupAssetAction(value.trim());
          if (r.error) setMsg({ ok: false, text: r.error });
          else if (!r.provider) setMsg(null);
          else setMsg(r.asset ? { ok: true, text: `✓ ${[r.asset.name, r.asset.model].filter(Boolean).join(" · ")}` } : { ok: false, text: t("notFound") });
        })}><Search /> {t("check")}</Button>
      </div>
      {msg && <p className={msg.ok ? "text-xs text-success" : "text-xs text-amber-700 dark:text-amber-300"} data-testid="asset-check-result">{msg.text}</p>}
    </div>
  );
}
