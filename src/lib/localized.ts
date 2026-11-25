import type { Locale } from "@/i18n/config";

/** Display name of admin-configured data: Thai name when the UI is Thai and one exists. */
export function ln(entity: { name: string; nameTh?: string | null } | null | undefined, locale: Locale): string {
  if (!entity) return "";
  return locale === "th" && entity.nameTh?.trim() ? entity.nameTh : entity.name;
}

/** Picks the article text in the viewer's language, falling back to the other one. */
export function pickLang<T extends string | null | undefined>(en: T, th: T, locale: Locale): string {
  const a = (locale === "th" ? th : en) ?? "";
  return a.trim() ? a : ((locale === "th" ? en : th) ?? "");
}
