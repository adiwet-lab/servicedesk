import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { canWriteKb, kbOptions } from "@/server/services/kb";
import { PageHeader } from "@/components/ui/misc";
import { ArticleEditor } from "@/components/kb/kb-client";
import { pageTitle } from "@/i18n/metadata";
import { getTranslations } from "next-intl/server";
import { currentLocale } from "@/i18n/server";

export const generateMetadata = pageTitle("newArticle");

export default async function NewArticlePage() {
  const actor = await requireAdminPortal();
  if (!canWriteKb(actor)) notFound();
  const [t, locale] = await Promise.all([getTranslations("kbAdmin"), currentLocale()]);
  return (
    <div className="space-y-5">
      <PageHeader title={t("newArticle")} description={t("newDescription")} />
      <ArticleEditor categories={await kbOptions(locale)} />
    </div>
  );
}
