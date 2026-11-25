import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

/** `export const generateMetadata = pageTitle("tickets")` — localized browser title from messages.pageTitle.* */
export function pageTitle(key: string) {
  return async (): Promise<Metadata> => {
    const t = await getTranslations("pageTitle");
    return { title: t(key as never) };
  };
}
