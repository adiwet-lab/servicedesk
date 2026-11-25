import "server-only";
import { getLocale, getTranslations } from "next-intl/server";
import { makeFormat } from "@/lib/format";
import { isLocale, DEFAULT_LOCALE, type Locale } from "./config";

/** Current request locale (server components / actions). */
export async function currentLocale(): Promise<Locale> {
  const l = await getLocale();
  return isLocale(l) ? l : DEFAULT_LOCALE;
}

/** Formatter bound to the request locale. */
export async function getFormat() {
  return makeFormat(await currentLocale());
}

export { getTranslations };
