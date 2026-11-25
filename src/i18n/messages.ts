import type { Locale } from "./config";
import en from "../../messages/en.json";
import th from "../../messages/th.json";

export const MESSAGES = { en, th } as const;
export type Messages = typeof en;
export function messagesFor(locale: Locale): Messages {
  return MESSAGES[locale] as Messages;
}
