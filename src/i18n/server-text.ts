import { messagesFor } from "./messages";
import { makeFormat } from "@/lib/format";

/**
 * Thai labels for params of stored notifications (the Thai message references `…Th` params).
 * Server code without a request locale uses this; English comes from the catalog's en side.
 */
const th = messagesFor("th");
const en = messagesFor("en");
export const thTaskStatus = (s: string) => (th.taskStatus as Record<string, string>)[s] ?? s;
export const enTaskStatus = (s: string) => (en.taskStatus as Record<string, string>)[s] ?? s;
export const thClock = (c: "response" | "resolution") => th.clock[c];
export const thMiStatus = (s: string) => (th.miStatus as Record<string, string>)[s] ?? s;
export const thDuration = (minutes: number) => makeFormat("th").duration(minutes);
/** Name pair for a localized entity param. */
export const nameTh = (e: { name: string; nameTh?: string | null } | null | undefined) => (e?.nameTh?.trim() ? e.nameTh : e?.name ?? "");
