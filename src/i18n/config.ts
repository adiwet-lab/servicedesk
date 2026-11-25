/** Supported UI languages. Thai is the organisation default. */
export const LOCALES = ["th", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "th";
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_LABEL: Record<Locale, string> = { th: "ไทย", en: "English" };

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** Resolution order: user preference → cookie → default. */
export function resolveLocale(userLocale: string | null | undefined, cookieLocale: string | null | undefined): Locale {
  if (isLocale(userLocale)) return userLocale;
  if (isLocale(cookieLocale)) return cookieLocale;
  return DEFAULT_LOCALE;
}

/** BCP-47 tag for Intl formatting (Thai uses the Buddhist calendar by default). */
export const INTL_LOCALE: Record<Locale, string> = { th: "th-TH", en: "en-GB" };
