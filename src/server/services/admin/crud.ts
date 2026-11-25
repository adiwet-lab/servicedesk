import { z } from "zod";
import { messagesFor } from "@/i18n/messages";
import type { Locale } from "@/i18n/config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz/actor";
import { requirePermission } from "@/server/authz/guards";
import { ValidationError, NotFoundError } from "@/server/authz/errors";
import { PERMISSIONS as P, type PermissionCode } from "@/server/authz/permissions";
import { CONFIGURABLE_REQUIRED_FIELDS } from "@/lib/validation/ticket";
import { audit, diff } from "../audit";

/**
 * Declarative admin CRUD registry. Each entity declares its form fields, list
 * columns, the permission that guards it, and how to persist values. The
 * generic engine handles validation, uniqueness errors, transactions and audit.
 * Records are never hard-deleted — they are deactivated.
 */

export type FieldType = "text" | "textarea" | "number" | "checkbox" | "select" | "multiselect" | "color" | "datetime";
export interface FieldOption { value: string; label: string; group?: string }
export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOption[];
  hint?: string;
  placeholder?: string;
  /** Field cannot be changed after creation (e.g. codes). */
  immutable?: boolean;
  max?: number;
  pattern?: { regex: string; message: string };
}
export interface ColumnDef { key: string; label: string; kind?: "text" | "badge" | "color" | "bool" | "mono" }
export interface CrudRow { id: string; isActive: boolean; cells: Record<string, string | number | boolean | null>; values: Record<string, unknown> }

type Tx = Prisma.TransactionClient;
type Values = Record<string, unknown>;

interface EntityDef {
  title: string;
  singular: string;
  permission: PermissionCode;
  auditType: string;
  description?: string;
  fields(): Promise<FieldDef[]>;
  columns: ColumnDef[];
  list(): Promise<CrudRow[]>;
  /** Persist; returns before/after snapshots for auditing. */
  save(tx: Tx, id: string | null, v: Values): Promise<{ id: string; before: Values | null; after: Values }>;
  setActive?(tx: Tx, id: string, active: boolean): Promise<void>;
}

// ───────────── option helpers ─────────────
const opt = {
  companies: async () => (await prisma.company.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } })).map((c) => ({ value: c.id, label: c.name })),
  branches: async () => (await prisma.branch.findMany({ where: { deletedAt: null }, include: { company: true }, orderBy: { name: "asc" } }))
    .map((b) => ({ value: b.id, label: b.name, group: b.company.name })),
  departments: async () => (await prisma.department.findMany({ where: { deletedAt: null }, include: { company: true }, orderBy: { name: "asc" } }))
    .map((d) => ({ value: d.id, label: d.name, group: d.company.name })),
  teams: async () => (await prisma.supportTeam.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } })).map((t) => ({ value: t.id, label: `${t.name}${t.isActive ? "" : " (inactive)"}` })),
  priorities: async () => (await prisma.priority.findMany({ orderBy: { level: "asc" } })).map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` })),
  slaProfiles: async () => (await prisma.slaProfile.findMany({ orderBy: { name: "asc" } })).map((s) => ({ value: s.id, label: s.name })),
  roles: async () => (await prisma.role.findMany({ orderBy: { name: "asc" } })).map((r) => ({ value: r.id, label: r.name })),
  tenants: async () => (await prisma.tenant.findMany({ orderBy: { name: "asc" } })).map((t) => ({ value: t.id, label: t.name })),
  mainCategories: async () => (await prisma.category.findMany({ where: { parentId: null, deletedAt: null }, orderBy: { sortOrder: "asc" } })).map((c) => ({ value: c.id, label: c.name })),
  supportUsers: async () => (await prisma.user.findMany({ where: { deletedAt: null, status: "ACTIVE", teamMemberships: { some: {} } }, orderBy: { displayName: "asc" } }))
    .map((u) => ({ value: u.id, label: `${u.displayName} (${u.email})` })),
};
const VISIBILITY_OPTIONS = [
  { value: "OWN", label: "Own tickets only" }, { value: "OWN_DEPT", label: "Own + Department" },
  { value: "OWN_BRANCH", label: "Own + Branch" }, { value: "OWN_DEPT_BRANCH", label: "Own + Department + Branch" },
];

const s = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
const nameOf = (opts: FieldOption[], id: unknown) => opts.find((o) => o.value === id)?.label ?? null;
const CODE = { regex: "^[A-Za-z0-9_\\-]+$", message: "Letters, digits, - and _ only" };

// ───────────── entity definitions ─────────────
const ENTITIES = {
  companies: {
    title: "Companies", singular: "Company", permission: P.ADMIN_ORG, auditType: "Company",
    async fields() {
      return [
        { name: "code", label: "Code", type: "text", required: true, immutable: true, max: 20, pattern: CODE },
        { name: "name", label: "Name", type: "text", required: true },
      ];
    },
    columns: [{ key: "code", label: "Code", kind: "mono" }, { key: "name", label: "Name" }, { key: "depts", label: "Departments" }, { key: "branches", label: "Branches" }],
    async list() {
      const rows = await prisma.company.findMany({ where: { deletedAt: null }, include: { _count: { select: { departments: true, branches: true } } }, orderBy: { name: "asc" } });
      return rows.map((r) => ({ id: r.id, isActive: r.isActive, values: { code: r.code, name: r.name },
        cells: { code: r.code, name: r.name, depts: r._count.departments, branches: r._count.branches } }));
    },
    async save(tx, id, v) {
      const data = { name: String(v.name) };
      if (id) {
        const before = await tx.company.findUniqueOrThrow({ where: { id } });
        await tx.company.update({ where: { id }, data });
        return { id, before, after: data };
      }
      const r = await tx.company.create({ data: { ...data, code: String(v.code).toUpperCase() } });
      return { id: r.id, before: null, after: r };
    },
    async setActive(tx, id, active) { await tx.company.update({ where: { id }, data: { isActive: active } }); },
  },

  departments: {
    title: "Departments", singular: "Department", permission: P.ADMIN_ORG, auditType: "Department",
    description: "Departments belong to a company. Employees of one department may work at any branch/location.",
    async fields() {
      return [
        { name: "companyId", label: "Company", type: "select", required: true, options: await opt.companies(), immutable: true },
        { name: "code", label: "Code", type: "text", required: true, immutable: true, max: 20, pattern: CODE },
        { name: "name", label: "Name", type: "text", required: true },
        { name: "nameTh", label: "Name (TH)", type: "text", hint: "Thai display name. Leave empty to show the English name." },
      ];
    },
    columns: [{ key: "company", label: "Company" }, { key: "code", label: "Code", kind: "mono" }, { key: "name", label: "Name" }, { key: "nameTh", label: "Name (TH)" }, { key: "users", label: "Employees" }],
    async list() {
      const rows = await prisma.department.findMany({ where: { deletedAt: null }, include: { company: true, _count: { select: { users: true } } }, orderBy: [{ company: { name: "asc" } }, { name: "asc" }] });
      return rows.map((r) => ({ id: r.id, isActive: r.isActive, values: { companyId: r.companyId, code: r.code, name: r.name, nameTh: r.nameTh },
        cells: { company: r.company.name, code: r.code, name: r.name, nameTh: r.nameTh ?? "—", users: r._count.users } }));
    },
    async save(tx, id, v) {
      if (id) {
        const before = await tx.department.findUniqueOrThrow({ where: { id } });
        await tx.department.update({ where: { id }, data: { name: String(v.name), nameTh: s(v.nameTh) } });
        return { id, before, after: { name: v.name, nameTh: s(v.nameTh) } };
      }
      const r = await tx.department.create({ data: { companyId: String(v.companyId), code: String(v.code).toUpperCase(), name: String(v.name), nameTh: s(v.nameTh) } });
      return { id: r.id, before: null, after: r };
    },
    async setActive(tx, id, active) { await tx.department.update({ where: { id }, data: { isActive: active } }); },
  },

  branches: {
    title: "Branches", singular: "Branch", permission: P.ADMIN_ORG, auditType: "Branch",
    async fields() {
      return [
        { name: "companyId", label: "Company", type: "select", required: true, options: await opt.companies(), immutable: true },
        { name: "code", label: "Code", type: "text", required: true, immutable: true, max: 20, pattern: CODE },
        { name: "name", label: "Name", type: "text", required: true },
        { name: "nameTh", label: "Name (TH)", type: "text", hint: "Thai display name. Leave empty to show the English name." },
        { name: "address", label: "Address", type: "textarea" },
      ];
    },
    columns: [{ key: "company", label: "Company" }, { key: "code", label: "Code", kind: "mono" }, { key: "name", label: "Name" }, { key: "nameTh", label: "Name (TH)" }, { key: "locations", label: "Locations" }],
    async list() {
      const rows = await prisma.branch.findMany({ where: { deletedAt: null }, include: { company: true, _count: { select: { locations: true } } }, orderBy: [{ company: { name: "asc" } }, { name: "asc" }] });
      return rows.map((r) => ({ id: r.id, isActive: r.isActive, values: { companyId: r.companyId, code: r.code, name: r.name, nameTh: r.nameTh, address: r.address },
        cells: { company: r.company.name, code: r.code, name: r.name, nameTh: r.nameTh ?? "—", locations: r._count.locations } }));
    },
    async save(tx, id, v) {
      const data = { name: String(v.name), nameTh: s(v.nameTh), address: s(v.address) };
      if (id) {
        const before = await tx.branch.findUniqueOrThrow({ where: { id } });
        await tx.branch.update({ where: { id }, data });
        return { id, before, after: data };
      }
      const r = await tx.branch.create({ data: { ...data, companyId: String(v.companyId), code: String(v.code).toUpperCase() } });
      return { id: r.id, before: null, after: r };
    },
    async setActive(tx, id, active) { await tx.branch.update({ where: { id }, data: { isActive: active } }); },
  },

  locations: {
    title: "Locations", singular: "Location", permission: P.ADMIN_ORG, auditType: "Location",
    async fields() {
      return [
        { name: "branchId", label: "Branch", type: "select", required: true, options: await opt.branches(), immutable: true },
        { name: "code", label: "Code", type: "text", required: true, immutable: true, max: 20, pattern: CODE },
        { name: "name", label: "Name", type: "text", required: true },
        { name: "nameTh", label: "Name (TH)", type: "text", hint: "Thai display name. Leave empty to show the English name." },
      ];
    },
    columns: [{ key: "branch", label: "Branch" }, { key: "code", label: "Code", kind: "mono" }, { key: "name", label: "Name" }, { key: "nameTh", label: "Name (TH)" }],
    async list() {
      const rows = await prisma.location.findMany({ where: { deletedAt: null }, include: { branch: true }, orderBy: [{ branch: { name: "asc" } }, { name: "asc" }] });
      return rows.map((r) => ({ id: r.id, isActive: r.isActive, values: { branchId: r.branchId, code: r.code, name: r.name, nameTh: r.nameTh },
        cells: { branch: r.branch.name, code: r.code, name: r.name, nameTh: r.nameTh ?? "—" } }));
    },
    async save(tx, id, v) {
      if (id) {
        const before = await tx.location.findUniqueOrThrow({ where: { id } });
        await tx.location.update({ where: { id }, data: { name: String(v.name), nameTh: s(v.nameTh) } });
        return { id, before, after: { name: v.name, nameTh: s(v.nameTh) } };
      }
      const r = await tx.location.create({ data: { branchId: String(v.branchId), code: String(v.code).toUpperCase(), name: String(v.name), nameTh: s(v.nameTh) } });
      return { id: r.id, before: null, after: r };
    },
    async setActive(tx, id, active) { await tx.location.update({ where: { id }, data: { isActive: active } }); },
  },

  priorities: {
    title: "Priorities", singular: "Priority", permission: P.ADMIN_CATEGORIES, auditType: "Priority",
    description: "Level 1 is the most urgent. SLA targets per priority are configured in SLA profiles.",
    async fields() {
      return [
        { name: "code", label: "Code", type: "text", required: true, immutable: true, max: 10, pattern: CODE },
        { name: "name", label: "Name", type: "text", required: true },
        { name: "nameTh", label: "Name (TH)", type: "text", hint: "Thai display name. Leave empty to show the English name." },
        { name: "level", label: "Level (1 = highest)", type: "number", required: true },
        { name: "color", label: "Colour", type: "color", required: true },
      ];
    },
    columns: [{ key: "code", label: "Code", kind: "mono" }, { key: "name", label: "Name" }, { key: "nameTh", label: "Name (TH)" }, { key: "level", label: "Level" }, { key: "color", label: "Colour", kind: "color" }],
    async list() {
      const rows = await prisma.priority.findMany({ orderBy: { level: "asc" } });
      return rows.map((r) => ({ id: r.id, isActive: r.isActive, values: { code: r.code, name: r.name, nameTh: r.nameTh, level: r.level, color: r.color },
        cells: { code: r.code, name: r.name, nameTh: r.nameTh ?? "—", level: r.level, color: r.color } }));
    },
    async save(tx, id, v) {
      const data = { name: String(v.name), nameTh: s(v.nameTh), level: Number(v.level), color: String(v.color) };
      if (id) {
        const before = await tx.priority.findUniqueOrThrow({ where: { id } });
        await tx.priority.update({ where: { id }, data });
        return { id, before, after: data };
      }
      const r = await tx.priority.create({ data: { ...data, code: String(v.code).toUpperCase() } });
      return { id: r.id, before: null, after: r };
    },
    async setActive(tx, id, active) { await tx.priority.update({ where: { id }, data: { isActive: active } }); },
  },

  categories: {
    title: "Categories & Subcategories", singular: "Category", permission: P.ADMIN_CATEGORIES, auditType: "Category",
    description: "Leave Parent empty for a main category. Defaults drive automatic routing, priority and SLA.",
    async fields() {
      return [
        { name: "parentId", label: "Parent (main category)", type: "select", options: await opt.mainCategories(), immutable: true, hint: "Empty = main category" },
        { name: "code", label: "Code", type: "text", required: true, immutable: true, max: 30, pattern: CODE },
        { name: "name", label: "Name", type: "text", required: true },
        { name: "nameTh", label: "Name (TH)", type: "text", hint: "Thai display name. Leave empty to show the English name." },
        { name: "description", label: "Description", type: "textarea" },
        { name: "defaultTeamId", label: "Default support team", type: "select", options: await opt.teams() },
        { name: "defaultPriorityId", label: "Default priority", type: "select", options: await opt.priorities() },
        { name: "slaProfileId", label: "SLA profile", type: "select", options: await opt.slaProfiles(), hint: "Empty = inherit from team / default" },
        { name: "requiredFields", label: "Required fields on create", type: "multiselect",
          options: Object.entries(CONFIGURABLE_REQUIRED_FIELDS).map(([value, label]) => ({ value, label })) },
        { name: "sortOrder", label: "Sort order", type: "number" },
      ];
    },
    columns: [{ key: "path", label: "Category" }, { key: "nameTh", label: "Name (TH)" }, { key: "code", label: "Code", kind: "mono" }, { key: "team", label: "Default team" }, { key: "priority", label: "Default priority" }, { key: "required", label: "Required fields" }],
    async list() {
      const rows = await prisma.category.findMany({
        where: { deletedAt: null },
        include: { parent: true, defaultTeam: true, defaultPriority: true },
      });
      const sortKey = (r: (typeof rows)[number]) =>
        r.parent ? `${String(r.parent.sortOrder).padStart(5, "0")}-${r.parent.name}-1-${String(r.sortOrder).padStart(5, "0")}-${r.name}` : `${String(r.sortOrder).padStart(5, "0")}-${r.name}-0`;
      rows.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      return rows.map((r) => ({
        id: r.id, isActive: r.isActive,
        values: { parentId: r.parentId, code: r.code, name: r.name, nameTh: r.nameTh, description: r.description, defaultTeamId: r.defaultTeamId,
          defaultPriorityId: r.defaultPriorityId, slaProfileId: r.slaProfileId, requiredFields: r.requiredFields, sortOrder: r.sortOrder },
        cells: { path: r.parent ? `↳ ${r.name}` : r.name, nameTh: r.nameTh ?? "—", code: r.code, team: r.defaultTeam?.name ?? (r.parent ? "(inherit)" : "—"),
          priority: r.defaultPriority?.code ?? "—", required: ((r.requiredFields as string[]) ?? []).map((k) => CONFIGURABLE_REQUIRED_FIELDS[k as keyof typeof CONFIGURABLE_REQUIRED_FIELDS] ?? k).join(", ") || "—" },
      }));
    },
    async save(tx, id, v) {
      const data = {
        name: String(v.name), nameTh: s(v.nameTh), description: s(v.description), defaultTeamId: s(v.defaultTeamId), defaultPriorityId: s(v.defaultPriorityId),
        slaProfileId: s(v.slaProfileId), requiredFields: (v.requiredFields as string[]) ?? [], sortOrder: Number(v.sortOrder ?? 0),
      };
      if (id) {
        const before = await tx.category.findUniqueOrThrow({ where: { id } });
        await tx.category.update({ where: { id }, data });
        return { id, before, after: data };
      }
      const parentId = s(v.parentId);
      if (parentId) {
        const parent = await tx.category.findUnique({ where: { id: parentId } });
        if (!parent || parent.parentId) throw new ValidationError("Parent must be a main category.", { parentId: "Parent must be a main category" });
      }
      const r = await tx.category.create({ data: { ...data, parentId, code: String(v.code).toUpperCase() } });
      return { id: r.id, before: null, after: r };
    },
    async setActive(tx, id, active) { await tx.category.update({ where: { id }, data: { isActive: active } }); },
  },

  routing: {
    title: "Auto-assignment Rules", singular: "Routing rule", permission: P.ADMIN_CATEGORIES, auditType: "RoutingRule",
    description: "Rules are evaluated in ascending order before category defaults. Empty conditions match anything.",
    async fields() {
      const cats = await prisma.category.findMany({ where: { deletedAt: null }, include: { parent: true }, orderBy: { name: "asc" } });
      return [
        { name: "name", label: "Rule name", type: "text", required: true },
        { name: "order", label: "Order", type: "number", required: true },
        { name: "categoryId", label: "Category / subcategory", type: "select",
          options: cats.map((c) => ({ value: c.id, label: c.parent ? `${c.parent.name} › ${c.name}` : c.name })) },
        { name: "priorityId", label: "When priority is", type: "select", options: await opt.priorities() },
        { name: "branchId", label: "When branch is", type: "select", options: await opt.branches() },
        { name: "departmentId", label: "When department is", type: "select", options: await opt.departments() },
        { name: "targetTeamId", label: "Assign to team", type: "select", required: true, options: await opt.teams() },
        { name: "targetAgentId", label: "Assign to agent (optional)", type: "select", options: await opt.supportUsers(), hint: "Must be a member of the team" },
      ];
    },
    columns: [{ key: "order", label: "Order" }, { key: "name", label: "Name" }, { key: "category", label: "Category" }, { key: "conditions", label: "Conditions" }, { key: "team", label: "Team" }, { key: "agent", label: "Agent" }],
    async list() {
      const [rows, pri, br, dp] = await Promise.all([
        prisma.routingRule.findMany({ include: { category: true, targetTeam: true, targetAgent: true }, orderBy: { order: "asc" } }),
        opt.priorities(), opt.branches(), opt.departments(),
      ]);
      return rows.map((r) => {
        const c = (r.conditions ?? {}) as Record<string, string>;
        const cond = [nameOf(pri, c.priorityId), nameOf(br, c.branchId), nameOf(dp, c.departmentId)].filter(Boolean).join(", ");
        return { id: r.id, isActive: r.isActive,
          values: { name: r.name, order: r.order, categoryId: r.categoryId, targetTeamId: r.targetTeamId, targetAgentId: r.targetAgentId, ...c },
          cells: { order: r.order, name: r.name, category: r.category?.name ?? "Any", conditions: cond || "—", team: r.targetTeam.name, agent: r.targetAgent?.displayName ?? "—" } };
      });
    },
    async save(tx, id, v) {
      const targetAgentId = s(v.targetAgentId);
      if (targetAgentId) {
        const m = await tx.teamMember.findFirst({ where: { teamId: String(v.targetTeamId), userId: targetAgentId } });
        if (!m) throw new ValidationError("Agent is not a member of the team.", { targetAgentId: "Agent is not a member of the selected team" });
      }
      const conditions: Record<string, string> = {};
      for (const k of ["priorityId", "branchId", "departmentId"]) if (s(v[k])) conditions[k] = String(v[k]);
      const data = { name: String(v.name), order: Number(v.order), categoryId: s(v.categoryId), conditions, targetTeamId: String(v.targetTeamId), targetAgentId };
      if (id) {
        const before = await tx.routingRule.findUniqueOrThrow({ where: { id } });
        await tx.routingRule.update({ where: { id }, data });
        return { id, before, after: data };
      }
      const r = await tx.routingRule.create({ data });
      return { id: r.id, before: null, after: r };
    },
    async setActive(tx, id, active) { await tx.routingRule.update({ where: { id }, data: { isActive: active } }); },
  },

  statuses: {
    title: "Ticket Statuses", singular: "Status", permission: P.ADMIN_WORKFLOW, auditType: "TicketStatus",
    description: "Kind drives system behaviour (e.g. WAITING requires a reason, RESOLVED requires a resolution). Transitions are managed under Workflow.",
    async fields() {
      return [
        { name: "code", label: "Code", type: "text", required: true, immutable: true, max: 30, pattern: CODE },
        { name: "name", label: "Name", type: "text", required: true },
        { name: "nameTh", label: "Name (TH)", type: "text", hint: "Thai display name. Leave empty to show the English name." },
        { name: "kind", label: "Kind", type: "select", required: true, immutable: true,
          options: ["NEW", "OPEN", "WAITING", "RESOLVED", "CLOSED", "CANCELLED"].map((k) => ({ value: k, label: k })) },
        { name: "color", label: "Colour", type: "color", required: true },
        { name: "order", label: "Display order", type: "number" },
        { name: "requiresReason", label: "Requires reason", type: "checkbox" },
        { name: "pausesSla", label: "Pauses SLA clock", type: "checkbox" },
        { name: "isDefault", label: "Initial status for new tickets", type: "checkbox" },
      ];
    },
    columns: [{ key: "name", label: "Name" }, { key: "nameTh", label: "Name (TH)" }, { key: "code", label: "Code", kind: "mono" }, { key: "kind", label: "Kind", kind: "badge" }, { key: "color", label: "Colour", kind: "color" }, { key: "requiresReason", label: "Reason", kind: "bool" }, { key: "pausesSla", label: "Pauses SLA", kind: "bool" }, { key: "isDefault", label: "Initial", kind: "bool" }],
    async list() {
      const rows = await prisma.ticketStatus.findMany({ orderBy: { order: "asc" } });
      return rows.map((r) => ({ id: r.id, isActive: r.isActive,
        values: { code: r.code, name: r.name, nameTh: r.nameTh, kind: r.kind, color: r.color, order: r.order, requiresReason: r.requiresReason, pausesSla: r.pausesSla, isDefault: r.isDefault },
        cells: { name: r.name, nameTh: r.nameTh ?? "—", code: r.code, kind: r.kind, color: r.color, requiresReason: r.requiresReason, pausesSla: r.pausesSla, isDefault: r.isDefault } }));
    },
    async save(tx, id, v) {
      const data = { name: String(v.name), nameTh: s(v.nameTh), color: String(v.color), order: Number(v.order ?? 0), requiresReason: !!v.requiresReason, pausesSla: !!v.pausesSla, isDefault: !!v.isDefault };
      if (data.isDefault) await tx.ticketStatus.updateMany({ where: { isDefault: true, ...(id ? { NOT: { id } } : {}) }, data: { isDefault: false } });
      if (id) {
        const before = await tx.ticketStatus.findUniqueOrThrow({ where: { id } });
        if (data.isDefault && before.kind !== "NEW") throw new ValidationError("Only a NEW-kind status can be the initial status.");
        await tx.ticketStatus.update({ where: { id }, data });
        return { id, before, after: data };
      }
      const kind = String(v.kind) as never;
      if (data.isDefault && kind !== "NEW") throw new ValidationError("Only a NEW-kind status can be the initial status.");
      const r = await tx.ticketStatus.create({ data: { ...data, code: String(v.code).toUpperCase(), kind } });
      return { id: r.id, before: null, after: r };
    },
    async setActive(tx, id, active) {
      const st = await tx.ticketStatus.findUniqueOrThrow({ where: { id } });
      if (!active && st.isDefault) throw new ValidationError("The initial status cannot be deactivated.");
      await tx.ticketStatus.update({ where: { id }, data: { isActive: active } });
    },
  },

  teams: {
    title: "Support Teams", singular: "Support team", permission: P.ADMIN_TEAMS, auditType: "SupportTeam",
    description: "Internal, vendor and outsource teams. Manage members from the team's Members page.",
    async fields() {
      return [
        { name: "code", label: "Team code", type: "text", required: true, immutable: true, max: 30, pattern: CODE },
        { name: "name", label: "Team name", type: "text", required: true },
        { name: "nameTh", label: "Name (TH)", type: "text", hint: "Thai display name. Leave empty to show the English name." },
        { name: "description", label: "Description", type: "textarea" },
        { name: "type", label: "Team type", type: "select", required: true, options: [{ value: "INTERNAL", label: "Internal" }, { value: "VENDOR", label: "External Vendor" }, { value: "OUTSOURCE", label: "Outsource" }] },
        { name: "companyId", label: "Company", type: "select", options: await opt.companies() },
        { name: "tenantId", label: "Microsoft tenant", type: "select", options: await opt.tenants() },
        { name: "slaProfileId", label: "SLA profile", type: "select", options: await opt.slaProfiles() },
      ];
    },
    columns: [{ key: "name", label: "Team" }, { key: "nameTh", label: "Name (TH)" }, { key: "code", label: "Code", kind: "mono" }, { key: "type", label: "Type", kind: "badge" }, { key: "tenant", label: "Tenant" }, { key: "lead", label: "Team lead" }, { key: "members", label: "Members" }],
    async list() {
      const rows = await prisma.supportTeam.findMany({ where: { deletedAt: null }, include: { tenant: true, lead: true, _count: { select: { members: true } } }, orderBy: { name: "asc" } });
      return rows.map((r) => ({ id: r.id, isActive: r.isActive,
        values: { code: r.code, name: r.name, nameTh: r.nameTh, description: r.description, type: r.type, companyId: r.companyId, tenantId: r.tenantId, slaProfileId: r.slaProfileId },
        cells: { name: r.name, nameTh: r.nameTh ?? "—", code: r.code, type: r.type, tenant: r.tenant?.name ?? "—", lead: r.lead?.displayName ?? "—", members: r._count.members } }));
    },
    async save(tx, id, v) {
      const data = { name: String(v.name), nameTh: s(v.nameTh), description: s(v.description), type: String(v.type) as never, companyId: s(v.companyId), tenantId: s(v.tenantId), slaProfileId: s(v.slaProfileId) };
      if (id) {
        const before = await tx.supportTeam.findUniqueOrThrow({ where: { id } });
        await tx.supportTeam.update({ where: { id }, data });
        return { id, before, after: data };
      }
      const r = await tx.supportTeam.create({ data: { ...data, code: String(v.code).toUpperCase() } });
      return { id: r.id, before: null, after: r };
    },
    async setActive(tx, id, active) { await tx.supportTeam.update({ where: { id }, data: { isActive: active } }); },
  },

  tenants: {
    title: "Microsoft Tenant Configuration", singular: "Tenant", permission: P.ADMIN_TENANTS, auditType: "Tenant",
    description: "Only users from active tenants listed here can sign in. Identity is (Tenant ID, Object ID) — email domains are never used for authorization.",
    async fields() {
      return [
        { name: "entraTenantId", label: "Entra Tenant ID (GUID)", type: "text", required: true, immutable: true,
          pattern: { regex: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", message: "Must be a GUID" } },
        { name: "name", label: "Organization name", type: "text", required: true },
        { name: "type", label: "Type", type: "select", required: true, options: [{ value: "INTERNAL", label: "Internal" }, { value: "VENDOR", label: "External vendor / outsource" }] },
        { name: "primaryDomain", label: "Primary domain (informational)", type: "text" },
        { name: "companyId", label: "Linked company", type: "select", options: await opt.companies() },
        { name: "autoProvisionUsers", label: "Auto-provision users on first sign-in", type: "checkbox", hint: "Otherwise new users are created as Pending for approval" },
        { name: "defaultRoleId", label: "Default role for new users", type: "select", options: await opt.roles() },
      ];
    },
    columns: [{ key: "name", label: "Organization" }, { key: "tid", label: "Tenant ID", kind: "mono" }, { key: "type", label: "Type", kind: "badge" }, { key: "domain", label: "Domain" }, { key: "auto", label: "Auto-provision", kind: "bool" }, { key: "role", label: "Default role" }, { key: "users", label: "Users" }],
    async list() {
      const rows = await prisma.tenant.findMany({ include: { defaultRole: true, _count: { select: { users: true } } }, orderBy: { name: "asc" } });
      return rows.map((r) => ({ id: r.id, isActive: r.isActive,
        values: { entraTenantId: r.entraTenantId, name: r.name, type: r.type, primaryDomain: r.primaryDomain, companyId: r.companyId, autoProvisionUsers: r.autoProvisionUsers, defaultRoleId: r.defaultRoleId },
        cells: { name: r.name, tid: r.entraTenantId, type: r.type, domain: r.primaryDomain ?? "—", auto: r.autoProvisionUsers, role: r.defaultRole?.name ?? "—", users: r._count.users } }));
    },
    async save(tx, id, v) {
      const data = { name: String(v.name), type: String(v.type) as never, primaryDomain: s(v.primaryDomain), companyId: s(v.companyId), autoProvisionUsers: !!v.autoProvisionUsers, defaultRoleId: s(v.defaultRoleId) };
      if (id) {
        const before = await tx.tenant.findUniqueOrThrow({ where: { id } });
        await tx.tenant.update({ where: { id }, data });
        return { id, before, after: data };
      }
      const r = await tx.tenant.create({ data: { ...data, entraTenantId: String(v.entraTenantId).toLowerCase() } });
      return { id: r.id, before: null, after: r };
    },
    async setActive(tx, id, active) { await tx.tenant.update({ where: { id }, data: { isActive: active } }); },
  },

  holidays: {
    title: "Holidays", singular: "Holiday", permission: P.ADMIN_SLA, auditType: "Holiday",
    description: "Holidays are excluded from business-hours SLA calculations.",
    async fields() {
      const bhs = await prisma.businessHours.findMany({ orderBy: { name: "asc" } });
      return [
        { name: "businessHoursId", label: "Business hours calendar", type: "select", required: true, options: bhs.map((b) => ({ value: b.id, label: b.name })) },
        { name: "date", label: "Date (YYYY-MM-DD)", type: "text", required: true, pattern: { regex: "^\\d{4}-\\d{2}-\\d{2}$", message: "Use YYYY-MM-DD" } },
        { name: "name", label: "Name", type: "text", required: true },
      ];
    },
    columns: [{ key: "date", label: "Date", kind: "mono" }, { key: "name", label: "Holiday" }, { key: "calendar", label: "Calendar" }],
    async list() {
      const rows = await prisma.holiday.findMany({ include: { businessHours: true }, orderBy: { date: "asc" } });
      return rows.map((r) => {
        const date = r.date.toISOString().slice(0, 10);
        return { id: r.id, isActive: true, values: { businessHoursId: r.businessHoursId, date, name: r.name }, cells: { date, name: r.name, calendar: r.businessHours.name } };
      });
    },
    async save(tx, id, v) {
      const data = { businessHoursId: String(v.businessHoursId), date: new Date(String(v.date)), name: String(v.name) };
      if (Number.isNaN(data.date.getTime())) throw new ValidationError("Invalid date.", { date: "Invalid date" });
      if (id) {
        const before = await tx.holiday.findUniqueOrThrow({ where: { id } });
        await tx.holiday.update({ where: { id }, data });
        return { id, before, after: data };
      }
      const r = await tx.holiday.create({ data });
      return { id: r.id, before: null, after: r };
    },
  },
  slaProfiles: {
    title: "SLA Profiles", singular: "SLA profile", permission: P.ADMIN_SLA, auditType: "SlaProfile",
    description: "Profiles are chosen per subcategory → category → support team → default. Targets per priority are edited on each profile's Targets page.",
    async fields() {
      const [bhs, statuses] = await Promise.all([
        prisma.businessHours.findMany({ orderBy: { name: "asc" } }),
        prisma.ticketStatus.findMany({ where: { isActive: true }, orderBy: { order: "asc" } }),
      ]);
      return [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "description", label: "Description", type: "textarea" },
        { name: "businessHoursId", label: "Business hours calendar", type: "select", options: bhs.map((b) => ({ value: b.id, label: b.name })), hint: "Empty = default calendar" },
        { name: "warningPercent", label: "Warning threshold (% of target elapsed)", type: "number", required: true },
        { name: "pauseStatusCodes", label: "Pause the SLA clock while the ticket is in", type: "multiselect",
          options: statuses.filter((st) => st.kind !== "RESOLVED" && st.kind !== "CLOSED" && st.kind !== "CANCELLED").map((st) => ({ value: st.code, label: st.name })),
          hint: "Empty = use each status's own 'Pauses SLA' flag" },
        { name: "isDefault", label: "Default profile", type: "checkbox" },
      ];
    },
    columns: [{ key: "name", label: "Profile" }, { key: "calendar", label: "Calendar" }, { key: "warning", label: "Warning" }, { key: "pause", label: "Pauses in" }, { key: "targets", label: "Targets" }, { key: "isDefault", label: "Default", kind: "bool" }],
    async list() {
      const rows = await prisma.slaProfile.findMany({ include: { businessHours: true, _count: { select: { targets: true } } }, orderBy: { name: "asc" } });
      const statuses = await prisma.ticketStatus.findMany();
      const sName = (c: string) => statuses.find((st) => st.code === c)?.name ?? c;
      return rows.map((r) => ({
        id: r.id, isActive: r.isActive,
        values: { name: r.name, description: r.description, businessHoursId: r.businessHoursId, warningPercent: r.warningPercent, pauseStatusCodes: r.pauseStatusCodes, isDefault: r.isDefault },
        cells: { name: r.name, calendar: r.businessHours?.name ?? "Default", warning: `${r.warningPercent}%`,
          pause: ((r.pauseStatusCodes as string[]) ?? []).map(sName).join(", ") || "(status flags)", targets: r._count.targets, isDefault: r.isDefault },
      }));
    },
    async save(tx, id, v) {
      const warningPercent = Number(v.warningPercent);
      if (warningPercent < 1 || warningPercent > 100) throw new ValidationError("Warning threshold must be 1–100%.", { warningPercent: "Must be between 1 and 100" });
      const data = { name: String(v.name), description: s(v.description), businessHoursId: s(v.businessHoursId), warningPercent,
        pauseStatusCodes: (v.pauseStatusCodes as string[]) ?? [], isDefault: !!v.isDefault };
      if (data.isDefault) await tx.slaProfile.updateMany({ where: { isDefault: true, ...(id ? { NOT: { id } } : {}) }, data: { isDefault: false } });
      if (id) {
        const before = await tx.slaProfile.findUniqueOrThrow({ where: { id } });
        await tx.slaProfile.update({ where: { id }, data });
        return { id, before, after: data };
      }
      const r = await tx.slaProfile.create({ data });
      return { id: r.id, before: null, after: r };
    },
    async setActive(tx, id, active) {
      const p = await tx.slaProfile.findUniqueOrThrow({ where: { id } });
      if (!active && p.isDefault) throw new ValidationError("The default SLA profile cannot be deactivated.");
      await tx.slaProfile.update({ where: { id }, data: { isActive: active } });
    },
  },

  escalations: {
    title: "Escalation Rules", singular: "Escalation rule", permission: P.ADMIN_SLA, auditType: "EscalationRule",
    description: "Fired once per ticket by the SLA job when the clock reaches the threshold (100% = breach). Notifies the owner team's leads and can move the ticket to another team.",
    async fields() {
      return [
        { name: "slaProfileId", label: "SLA profile", type: "select", required: true, options: await opt.slaProfiles() },
        { name: "clock", label: "Clock", type: "select", required: true, options: [{ value: "RESPONSE", label: "Response" }, { value: "RESOLUTION", label: "Resolution" }] },
        { name: "atPercent", label: "At % of target elapsed", type: "number", required: true, hint: "1–200 (e.g. 75 = warning stage, 100 = breach, 150 = well overdue)" },
        { name: "notifyTeamLead", label: "Notify owner team leads", type: "checkbox" },
        { name: "escalateToTeamId", label: "Escalate (transfer) to team", type: "select", options: await opt.teams(), hint: "Optional" },
      ];
    },
    columns: [{ key: "profile", label: "Profile" }, { key: "clock", label: "Clock", kind: "badge" }, { key: "at", label: "At" }, { key: "notify", label: "Notify leads", kind: "bool" }, { key: "team", label: "Escalate to" }],
    async list() {
      const rows = await prisma.escalationRule.findMany({ include: { slaProfile: true, escalateToTeam: true }, orderBy: [{ slaProfile: { name: "asc" } }, { clock: "asc" }, { atPercent: "asc" }] });
      return rows.map((r) => ({ id: r.id, isActive: r.isActive,
        values: { slaProfileId: r.slaProfileId, clock: r.clock, atPercent: r.atPercent, notifyTeamLead: r.notifyTeamLead, escalateToTeamId: r.escalateToTeamId },
        cells: { profile: r.slaProfile.name, clock: r.clock, at: `${r.atPercent}%`, notify: r.notifyTeamLead, team: r.escalateToTeam?.name ?? "—" } }));
    },
    async save(tx, id, v) {
      const atPercent = Number(v.atPercent);
      if (atPercent < 1 || atPercent > 200) throw new ValidationError("Threshold must be 1–200%.", { atPercent: "Must be between 1 and 200" });
      if (!v.notifyTeamLead && !s(v.escalateToTeamId)) throw new ValidationError("A rule must notify team leads and/or escalate to a team.", { notifyTeamLead: "Choose at least one action" });
      const data = { slaProfileId: String(v.slaProfileId), clock: String(v.clock) as never, atPercent, notifyTeamLead: !!v.notifyTeamLead, escalateToTeamId: s(v.escalateToTeamId) };
      if (id) {
        const before = await tx.escalationRule.findUniqueOrThrow({ where: { id } });
        await tx.escalationRule.update({ where: { id }, data });
        return { id, before, after: data };
      }
      const r = await tx.escalationRule.create({ data });
      return { id: r.id, before: null, after: r };
    },
    async setActive(tx, id, active) { await tx.escalationRule.update({ where: { id }, data: { isActive: active } }); },
  },
} satisfies Record<string, EntityDef>;

export type EntityKey = keyof typeof ENTITIES;
export const ENTITY_KEYS = Object.keys(ENTITIES) as EntityKey[];

function getEntity(key: string): EntityDef {
  const e = (ENTITIES as Record<string, EntityDef>)[key];
  if (!e) throw new NotFoundError("Unknown entity");
  return e;
}

/**
 * UI text of the entity definitions is written in English and translated through the `crud` catalog
 * namespace, looked up by its English value (unknown text, e.g. record names in options, passes through).
 */
export function crudTranslator(locale: Locale = "en"): (text: string) => string {
  if (locale === "en") return (x) => x;
  const en = messagesFor("en").crud as Record<string, string>;
  const loc = messagesFor(locale).crud as Record<string, string>;
  const map = new Map(Object.entries(en).map(([k, v]) => [v, loc[k] ?? v]));
  return (x) => map.get(x) ?? x;
}

function localizeFields(fields: FieldDef[], tr: (x: string) => string): FieldDef[] {
  return fields.map((f) => ({
    ...f, label: tr(f.label), hint: f.hint && tr(f.hint), placeholder: f.placeholder && tr(f.placeholder),
    pattern: f.pattern && { ...f.pattern, message: tr(f.pattern.message) },
    options: f.options?.map((o) => ({ ...o, label: tr(o.label), group: o.group })),
  }));
}

export async function loadCrudPage(actor: Actor, key: EntityKey, locale: Locale = "en") {
  const e = getEntity(key);
  requirePermission(actor, e.permission);
  const tr = crudTranslator(locale);
  const [fields, rows] = await Promise.all([e.fields(), e.list()]);
  return {
    key, title: tr(e.title), singular: tr(e.singular), description: e.description ? tr(e.description) : null,
    fields: localizeFields(fields, tr), columns: e.columns.map((c) => ({ ...c, label: tr(c.label) })), canToggle: !!e.setActive,
    // Fixed texts in cells (e.g. "(inherit)", required-field names) are translated; record names pass through.
    rows: locale === "en" ? rows : rows.map((r) => ({ ...r, cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, typeof v === "string" ? v.split(", ").map(tr).join(", ") : v])) })),
  };
}

function buildSchema(fields: FieldDef[], isCreate: boolean, locale: Locale = "en") {
  const m = messagesFor(locale).crudMsg;
  const req = (label: string) => m.required.replace("{label}", label);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    if (!isCreate && f.immutable) continue;
    let t: z.ZodTypeAny;
    switch (f.type) {
      case "number":
        t = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), f.required ? z.number({ invalid_type_error: req(f.label) }).int().min(0).max(1_000_000) : z.number().int().min(0).max(1_000_000).optional());
        break;
      case "checkbox":
        t = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
        break;
      case "multiselect": {
        const allowed = new Set((f.options ?? []).map((o) => o.value));
        t = z.array(z.string()).default([]).refine((arr) => arr.every((x) => allowed.has(x)), m.invalidSelection);
        break;
      }
      case "select": {
        const allowed = new Set((f.options ?? []).map((o) => o.value));
        const base = z.string().refine((x) => allowed.has(x), m.invalidSelection);
        t = z.preprocess((v) => (v === "" || v == null ? undefined : v), f.required ? base : base.optional());
        break;
      }
      case "color":
        t = z.string().regex(/^#[0-9a-fA-F]{6}$/, m.hexColour);
        break;
      default: {
        let str = z.string().trim().max(f.max ?? (f.type === "textarea" ? 2000 : 200));
        if (f.pattern) str = str.regex(new RegExp(f.pattern.regex), f.pattern.message);
        t = f.required
          ? z.string({ required_error: req(f.label) }).trim().min(1, req(f.label)).pipe(str)
          : z.preprocess((v) => (v === "" ? undefined : v), str.optional());
      }
    }
    shape[f.name] = t;
  }
  return z.object(shape);
}

export type CrudResult = { ok: true; id: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function saveCrud(actor: Actor, key: string, id: string | null, raw: Record<string, unknown>, locale: Locale = "en"): Promise<CrudResult> {
  const e = getEntity(key);
  requirePermission(actor, e.permission);
  const m = messagesFor(locale).crudMsg;
  const fields = localizeFields(await e.fields(), crudTranslator(locale));
  const parsed = buildSchema(fields, !id, locale).safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, error: m.correctFields, fieldErrors };
  }
  try {
    const res = await prisma.$transaction(async (tx) => {
      const out = await e.save(tx, id, parsed.data);
      const keys = Object.keys(parsed.data);
      const d = out.before ? diff(out.before, out.after, keys) : { oldValue: null, newValue: parsed.data, changed: true };
      if (d.changed) {
        await audit(tx, actor, { action: id ? `${e.auditType.toUpperCase()}_UPDATED` : `${e.auditType.toUpperCase()}_CREATED`,
          entityType: e.auditType, entityId: out.id, oldValue: d.oldValue, newValue: d.newValue });
      }
      return out;
    });
    return { ok: true, id: res.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined)?.join(", ") ?? "value";
      return { ok: false, error: m.duplicate.replace("{target}", target) };
    }
    if (err instanceof ValidationError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
    throw err;
  }
}

export async function setCrudActive(actor: Actor, key: string, id: string, active: boolean, locale: Locale = "en"): Promise<CrudResult> {
  const e = getEntity(key);
  requirePermission(actor, e.permission);
  if (!e.setActive) return { ok: false, error: messagesFor(locale).crudMsg.cannotDeactivate };
  try {
    await prisma.$transaction(async (tx) => {
      await e.setActive!(tx, id, active);
      await audit(tx, actor, { action: `${e.auditType.toUpperCase()}_${active ? "ACTIVATED" : "DEACTIVATED"}`, entityType: e.auditType, entityId: id });
    });
    return { ok: true, id };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, error: err.message };
    throw err;
  }
}

export { VISIBILITY_OPTIONS, opt as adminOptions };
