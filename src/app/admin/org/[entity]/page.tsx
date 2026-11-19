import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { CrudPage } from "@/components/admin/crud-page";
import { AuthorizationError } from "@/server/authz/errors";
import type { EntityKey } from "@/server/services/admin/crud";

const MAP: Record<string, EntityKey> = { companies: "companies", departments: "departments", branches: "branches", locations: "locations" };

export default async function OrgEntityPage({ params }: { params: Promise<{ entity: string }> }) {
  const actor = await requireAdminPortal();
  const { entity } = await params;
  const key = MAP[entity];
  if (!key) notFound();
  try {
    return await CrudPage({ actor, entity: key });
  } catch (e) {
    if (e instanceof AuthorizationError) notFound();
    throw e;
  }
}
