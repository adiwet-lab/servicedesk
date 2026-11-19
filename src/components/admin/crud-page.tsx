import type { Actor } from "@/server/authz/actor";
import { loadCrudPage, type EntityKey } from "@/server/services/admin/crud";
import { PageHeader } from "@/components/ui/misc";
import { CrudTable } from "./crud-table";

export async function CrudPage({ actor, entity, rowLink, extra }: { actor: Actor; entity: EntityKey; rowLink?: { label: string; hrefPrefix: string }; extra?: React.ReactNode }) {
  const page = await loadCrudPage(actor, entity);
  return (
    <div>
      <PageHeader title={page.title} description={page.description ?? undefined} />
      {extra}
      <CrudTable entity={page.key} singular={page.singular} fields={page.fields} columns={page.columns} rows={page.rows} canToggle={page.canToggle} rowLink={rowLink} />
    </div>
  );
}
