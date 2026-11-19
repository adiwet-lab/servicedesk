import { z } from "zod";

const optText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());
const optId = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().min(1).max(50).optional());

/** Fields that admins can mark as required per category. */
export const CONFIGURABLE_REQUIRED_FIELDS = {
  contactNumber: "Contact Number",
  relatedAsset: "Related Asset",
  affectedSystem: "Affected System",
  affectedUsers: "Affected Users",
  locationId: "Location",
  attachments: "Attachments",
} as const;
export type RequiredFieldKey = keyof typeof CONFIGURABLE_REQUIRED_FIELDS;

export const createTicketSchema = z.object({
  subject: z.string().trim().min(5, "Subject must be at least 5 characters").max(200),
  description: z.string().trim().min(10, "Please describe the issue (at least 10 characters)").max(20000),
  categoryId: z.string().min(1, "Main category is required"),
  subcategoryId: optId,
  priorityId: optId,
  requesterId: optId,
  branchId: optId,
  locationId: optId,
  contactNumber: optText(50),
  relatedAsset: optText(100),
  affectedSystem: optText(200),
  affectedUsers: optText(500),
  isConfidential: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()).default(false),
  impactScope: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(["SINGLE_USER", "SINGLE_BRANCH", "MULTIPLE_BRANCHES", "COMPANY_WIDE", "MULTIPLE_COMPANIES"]).optional()),
  impactBranchIds: z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.string().min(1).max(50)).max(500)).default([]),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const changeStatusSchema = z.object({
  ticketId: z.string().min(1),
  toStatusId: z.string().min(1),
  reason: optText(2000),
  resolutionSummary: optText(5000),
});

export const assignTicketSchema = z.object({
  ticketId: z.string().min(1),
  teamId: optId,
  agentId: optId,
  reason: optText(1000),
});

export const ticketListQuerySchema = z.object({
  q: optText(200),
  status: optId,
  priority: optId,
  category: optId,
  team: optId,
  agent: optId,
  branch: optId,
  department: optId,
  subcategory: optId,
  company: optId,
  /** Created-date window (YYYY-MM-DD, inclusive) — dashboard drill-down. */
  from: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()).catch(undefined),
  to: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()).catch(undefined),
  /** Open-ticket aging bucket — dashboard drill-down. */
  aging: z.enum(["0-1", "2-3", "4-7", "8-14", "15+"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10000).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).catch(20),
  sort: z.enum(["number", "subject", "createdAt", "updatedAt", "priority", "status", "resolutionDueAt"]).catch("createdAt"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
});
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;
