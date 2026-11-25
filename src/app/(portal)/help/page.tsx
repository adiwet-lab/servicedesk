import Link from "next/link";
import { Search } from "lucide-react";
import { requireActor } from "@/server/auth/get-actor";
import { helpCenterHome, searchArticles } from "@/server/services/kb";
import { PageHeader } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArticleList } from "@/components/kb/article-list";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";
import { currentLocale } from "@/i18n/server";

export const generateMetadata = pageTitle("helpCenter");

export default async function HelpCenterPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 200);
  const [t, tp, locale] = await Promise.all([getTranslations("help"), getTranslations("pageTitle"), currentLocale()]);
  const home = await helpCenterHome(actor, locale);
  const searching = !!q || !!sp.category;
  const results = searching ? await searchArticles(actor, q, { categoryId: sp.category, limit: 30, locale }) : [];
  const activeCat = home.categories.find((c) => c.id === sp.category);
  return (
    <div className="space-y-5">
      <PageHeader title={tp("helpCenter")} description={t("description")} />
      <form className="flex gap-2" role="search">
        {sp.category && <input type="hidden" name="category" value={sp.category} />}
        <Input name="q" defaultValue={q} placeholder={t("searchPlaceholder")} aria-label={t("searchArticles")} className="max-w-xl" data-testid="kb-search" />
        <Button type="submit"><Search /> {t("search")}</Button>
      </form>
      <div className="grid gap-5 lg:grid-cols-4">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">{t("categories")}</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              <li><Link href={q ? `/help?q=${encodeURIComponent(q)}` : "/help"} className={!sp.category ? "font-medium text-primary" : "hover:underline"}>{t("all")}</Link></li>
              {home.categories.map((c) => (
                <li key={c.id} className="flex justify-between">
                  <Link href={`/help?category=${c.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={sp.category === c.id ? "font-medium text-primary" : "hover:underline"}>{c.name}</Link>
                  <span className="text-muted-foreground tabular-nums">{c.count}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <div className="space-y-5 lg:col-span-3">
          {searching ? (
            <Card>
              <CardHeader><CardTitle className="text-base">{t("results", { count: results.length })}{q ? t("forQuery", { q }) : ""}{activeCat ? t("inCategory", { name: activeCat.name }) : ""}</CardTitle></CardHeader>
              <CardContent><ArticleList rows={results} hrefBase="/help" /></CardContent>
            </Card>
          ) : (
            <>
              <Card><CardHeader><CardTitle className="text-base">{t("faq")}</CardTitle></CardHeader><CardContent><ArticleList rows={home.faqs} hrefBase="/help" /></CardContent></Card>
              <Card><CardHeader><CardTitle className="text-base">{t("popular")}</CardTitle></CardHeader><CardContent><ArticleList rows={home.popular} hrefBase="/help" /></CardContent></Card>
            </>
          )}
          <p className="text-sm text-muted-foreground">{t("notFound")} <Link href="/tickets/new" className="text-primary hover:underline">{t("createTicket")}</Link></p>
        </div>
      </div>
    </div>
  );
}
