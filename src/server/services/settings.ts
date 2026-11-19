import { z } from "zod";
import type { PrismaClient, Prisma } from "@prisma/client";

/** Typed system settings with defaults. Stored as key/JSON rows in SystemSetting. */
export const SETTINGS_SCHEMA = {
  "attachments.maxFileSizeMb": z.number().int().min(1).max(100).default(10),
  "attachments.maxFilesPerUpload": z.number().int().min(1).max(20).default(5),
  "attachments.allowedExtensions": z
    .array(z.string().regex(/^[a-z0-9]+$/))
    .default(["jpg", "jpeg", "png", "pdf", "docx", "xlsx", "txt", "log"]),
  "tickets.reopenWindowDays": z.number().int().min(0).max(365).default(7),
  "tickets.autoCloseResolvedDays": z.number().int().min(0).max(365).default(3),
  "tickets.fallbackTeamCode": z.string().default("IT-SUPPORT"),
  "tickets.requesterCanSetPriority": z.boolean().default(true),
  "tickets.defaultPriorityCode": z.string().default("P3"),
  /** Status applied automatically when an agent is first assigned (if the workflow allows it). */
  "workflow.assignedStatusCode": z.string().default("ASSIGNED"),
  /** When the requester replies to a ticket in a WAITING status, move it to this status (empty = off). */
  "workflow.requesterReplyStatusCode": z.string().default("IN_PROGRESS"),
  /** Notification types switched off by administrators (in-app channel). */
  "notifications.disabledTypes": z.array(z.string()).default([]),
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS_SCHEMA)[K]>;
export type Settings = { [K in SettingKey]: SettingValue<K> };

type Db = PrismaClient | Prisma.TransactionClient;

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.systemSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<string, unknown>;
  for (const [key, schema] of Object.entries(SETTINGS_SCHEMA)) {
    const parsed = schema.safeParse(map.get(key));
    out[key] = parsed.success ? parsed.data : schema.parse(undefined);
  }
  return out as Settings;
}

export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<SettingValue<K>> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  const parsed = SETTINGS_SCHEMA[key].safeParse(row?.value);
  return (parsed.success ? parsed.data : SETTINGS_SCHEMA[key].parse(undefined)) as SettingValue<K>;
}
