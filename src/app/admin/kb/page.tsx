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
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";
import { currentLocale } from "@/i18n/server";

export const generateMetadata = pageTitle("knowledgeBase");

export default async function KbAdminPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; category?: string }> }) {
  const actor = await requireAdminPortal();
  const sp = await searchParams;
  const status = sp.status === "DRAFT" || sp.status === "PUBLISHED" || sp.status === "ARCHIVED" ? sp.status : undefined;
  const [t, tk, tp, locale] = await Promise.all([getTranslations("kbAdmin"), getTranslations("kb"), getTranslations("pageTitle"), currentLocale()]);
  let rows;
  try { rows = await listArticlesForAdmin(actor, { q: sp.q?.slice(0, 200), status, categoryId: sp.category || undefined, locale }); }
  catch (e) { if (e instanceof AuthorizationError) notFound(); throw e; }
  const cats = await kbOptions(locale);
  return (
    <div className="space-y-5">
      <PageHeader title={tp("knowledgeBase")} description={t("description")}
        actions={canWriteKb(actor) && <Button asChild><Link href="/admin/kb/new"><Plus /> {t("newArticle")}</Link></Button>} />
      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder={t("search")} className="w-64" aria-label={t("searchLabel")} />
        <NativeSelect name="status" defaultValue={status ?? ""} className="w-40" aria-label={t("status")}>
          <option value="">{t("allStatuses")}</option><option value="DRAFT">{tk("kbStatus.DRAFT")}</option><option value="PUBLISHED">{tk("kbStatus.PUBLISHED")}</option><option value="ARCHIVED">{tk("kbStatus.ARCHIVED")}</option>
        </NativeSelect>
        <NativeSelect name="category" defaultValue={sp.category ?? ""} className="w-52" aria-label={t("category")}>
          <option value="">{t("allCategories")}</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <Button type="submit" variant="outline">{t("filter")}</Button>
      </form>
      <Card><CardContent className="pt-2"><ArticleList rows={rows} hrefBase="/admin/kb" showStatus /></CardContent></Card>
    </div>
  );
}
