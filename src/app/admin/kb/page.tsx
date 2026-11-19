import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { canWriteKb, kbOptions, listArticlesForAdmin } from "@/server/services/kb";
import { AuthorizationError } from "@/server/authz/errors";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ArticleList } from "@/components/kb/article-list";

export const metadata = { title: "Knowledge Base" };

export default async function KbAdminPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; category?: string }> }) {
  const actor = await requireAdminPortal();
  const sp = await searchParams;
  const status = sp.status === "DRAFT" || sp.status === "PUBLISHED" || sp.status === "ARCHIVED" ? sp.status : undefined;
  let rows;
  try { rows = await listArticlesForAdmin(actor, { q: sp.q?.slice(0, 200), status, categoryId: sp.category || undefined }); }
  catch (e) { if (e instanceof AuthorizationError) notFound(); throw e; }
  const cats = await kbOptions();
  return (
    <div className="space-y-5">
      <PageHeader title="Knowledge Base" description="Write, review and publish articles for the Help Center and support staff."
        actions={canWriteKb(actor) && <Button asChild><Link href="/admin/kb/new"><Plus /> New article</Link></Button>} />
      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Search…" className="w-64" aria-label="Search" />
        <NativeSelect name="status" defaultValue={status ?? ""} className="w-40" aria-label="Status">
          <option value="">All statuses</option><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option>
        </NativeSelect>
        <NativeSelect name="category" defaultValue={sp.category ?? ""} className="w-52" aria-label="Category">
          <option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <Button type="submit" variant="outline">Filter</Button>
      </form>
      <Card><CardContent className="pt-2"><ArticleList rows={rows} hrefBase="/admin/kb" showStatus /></CardContent></Card>
    </div>
  );
}
