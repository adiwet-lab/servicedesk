import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireActor } from "@/server/auth/get-actor";
import { NotFoundError } from "@/server/authz/errors";
import { getArticle } from "@/server/services/kb";
import { getTranslations } from "next-intl/server";
import { currentLocale, getFormat } from "@/i18n/server";
import { isLocale, type Locale } from "@/i18n/config";
import { ln } from "@/lib/localized";
import { Markdown } from "@/components/kb/markdown";
import { FeedbackBox } from "@/components/kb/kb-client";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";

export default async function ArticlePage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ solved?: string; lang?: string }> }) {
  const actor = await requireActor();
  const { number } = await params;
  const sp = await searchParams;
  let a;
  try { a = await getArticle(actor, decodeURIComponent(number), { countView: true }); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const [t, tk, f, uiLocale] = await Promise.all([getTranslations("help"), getTranslations("kb"), getFormat(), currentLocale()]);
  const locale = uiLocale;
  // Reader's language first (or ?lang= override), falling back to the other language.
  const view: Locale = isLocale(sp.lang) ? sp.lang : uiLocale;
  const other: Locale = view === "th" ? "en" : "th";
  const hasLang = (l: Locale) => !!(l === "th" ? a.titleTh || a.bodyTh : a.title || a.body);
  const shown: Locale = hasLang(view) ? view : other;
  const title = shown === "th" ? a.titleTh ?? "" : a.title;
  const summary = shown === "th" ? a.summaryTh ?? "" : a.summary;
  const body = shown === "th" ? a.bodyTh ?? "" : a.body;
  return (
    <div className="mx-auto max-w-3xl space-y-4" lang={shown}>
      <Link href="/help" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {t("back")}</Link>
      {sp.solved === "1" && <Alert variant="success">{t("solved")}</Alert>}
      <div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{a.number}</span><Badge variant="secondary">{tk(`kbType.${a.type}`)}</Badge>
          {a.visibility === "SUPPORT_ONLY" && <Badge variant="warning">{tk("supportOnly")}</Badge>}
          {a.category && <span>{a.category.parent ? `${ln(a.category.parent, locale)} › ` : ""}{ln(a.category, locale)}</span>}
          {hasLang(other) && shown !== other && <Link href={`?lang=${other}`} className="text-primary hover:underline" data-testid="kb-other-lang">{t("readInOther", { language: t(`langName.${other}`) })}</Link>}
          {shown !== view && <span>{t("notInYourLanguage")}</span>}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight" data-testid="kb-title">{title}</h1>
        {summary && <p className="mt-1 text-muted-foreground">{summary}</p>}
        <p className="mt-1 text-xs text-muted-foreground">{t("updatedViews", { date: f.dateTime(a.updatedAt), views: a.viewCount + 1 })}</p>
      </div>
      <Card><CardContent className="pt-5"><Markdown source={body} /></CardContent></Card>
      <FeedbackBox articleId={a.id} mine={a.myFeedback} />
      <p className="text-sm text-muted-foreground">{t("stillNeedHelp")} <Link href="/tickets/new" className="text-primary hover:underline">{t("createTicket")}</Link></p>
    </div>
  );
}
