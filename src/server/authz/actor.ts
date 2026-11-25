import type { TenantType, TicketVisibility } from "@prisma/client";
import type { PermissionCode } from "./permissions";

/** The authenticated principal, reloaded from the DB on every request. */
export interface Actor {
  id: string;
  tenantId: string;
  tenantType: TenantType;
  email: string;
  displayName: string;
  companyId: string | null;
  departmentId: string | null;
  branchId: string | null;
  locationId: string | null;
  ticketVisibility: TicketVisibility;
  roleCodes: string[];
  permissions: ReadonlySet<PermissionCode>;
  /** Support teams the user belongs to (active teams only). */
  teamIds: string[];
  /** Teams the user leads. */
  leadTeamIds: string[];
  /** Preferred UI language ("th" | "en"); null = organisation default. */
  locale?: string | null;
  /** Request metadata used for auditing. */
  ip?: string | null;
  userAgent?: string | null;
}

export function isVendor(actor: Pick<Actor, "tenantType">) {
  return actor.tenantType === "VENDOR";
}
