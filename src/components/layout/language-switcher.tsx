"use client";
import { useTransition } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { setLocaleAction } from "@/server/actions/locale";
import { LOCALES, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

/** Deliberately bilingual so users can find the switch whatever the current language. */
const LANGUAGE_LABEL = ["Language", "ภาษา"].join(" / ");

/** TH | EN toggle. The choice is saved on the user profile and in a cookie. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const current = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className={cn("flex items-center gap-0.5 rounded-md border p-0.5 text-xs", className)} role="group" aria-label={LANGUAGE_LABEL} data-testid="language-switcher">
      <Languages className="mx-1 size-3.5 text-muted-foreground" aria-hidden />
      {LOCALES.map((l: Locale) => (
        <button key={l} type="button" disabled={pending} aria-pressed={current === l} data-testid={`lang-${l}`}
          onClick={() => start(async () => { await setLocaleAction(l); router.refresh(); })}
          className={cn("rounded px-1.5 py-0.5 font-medium uppercase transition-colors", current === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
          {l === "th" ? "TH" : "EN"}
        </button>
      ))}
    </div>
  );
}
