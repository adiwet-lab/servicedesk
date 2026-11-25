import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getActor } from "@/server/auth/get-actor";
import { LOCALE_COOKIE, resolveLocale } from "./config";
import { messagesFor } from "./messages";

/** Per-request locale for next-intl (no locale segment in URLs). */
export default getRequestConfig(async () => {
  const [actor, jar] = await Promise.all([getActor().catch(() => null), cookies()]);
  const locale = resolveLocale(actor?.locale, jar.get(LOCALE_COOKIE)?.value);
  return { locale, messages: messagesFor(locale), timeZone: "Asia/Bangkok" };
});
