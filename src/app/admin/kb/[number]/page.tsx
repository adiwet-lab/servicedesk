import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Archive, Send, Undo2, ExternalLink } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { NotFoundError } from "@/server/authz/errors";
import { getArticle, kbOptions, requireKbManager } from "@/server/services/kb";
import { setArticleStatusAction } from "@/server/actions/kb";
import { ArticleEditor } from "@/components/kb/kb-client";
import { Markdown } from "@/components/kb/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";
import { currentLocale, getFormat } from "@/i18n/server";
import { pickLang } from "@/lib/localized";

function StatusButton({ id, status, label, icon, variant = "outline" }: { id: string; status: string; label: string; icon: React.ReactNode; variant?: "default" | "outline" }) {
  return (
    <form action={setArticleStatusAction}>
      <input type="hidden" name="articleId" value={id} /><input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant} data-testid={`kb-${status.toLowerCase()}`}>{icon} {label}</Button>
    </form>
  );
}

export default async function ArticleAdminPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ saved?: string; fromTicket?: string }> }) {
  const tcfg = await getTranslations("cfg");
  const actor = await requireAdminPortal();
  try { requireKbManager(actor); } catch { notFound(); }
  const { number } = await params;
  const sp = await searchParams;
  let a;
  try { a = await getArticle(actor, decodeURIComponent(number), { management: true }); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const [t, tk, f, locale] = await Promise.all([getTranslations("kbAdmin"), getTranslations("kb"), getFormat(), currentLocale()]);
  const cats = await kbOptions(locale);
  return (
    <div className="space-y-5">
      <Link href="/admin/kb" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {t("back")}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><span className="font-mono text-sm font-semibold text-primary" data-testid="kb-number">{a.number}</span>
            <Badge variant={a.status === "PUBLISHED" ? "success" : "secondary"} data-testid="kb-status">{tk(`kbStatus.${a.status}`)}</Badge>
            <span className="text-xs text-muted-foreground">{tcfg("versionShort", { n: a.version })}</span></div>
          <h1 className="mt-1 text-xl font-semibold">{pickLang(a.title, a.titleTh, locale)}</h1>
          <p className="text-xs text-muted-foreground">{t("byline", { author: a.author.displayName })}{a.updatedBy ? t("lastEditedBy", { name: a.updatedBy.displayName }) : ""} · {f.dateTime(a.updatedAt)}
            {a.sourceTicket && <>{t("fromTicket")} <Link className="text-primary hover:underline" href={`/admin/tickets/${a.sourceTicket.number}`}>{a.sourceTicket.number}</Link></>}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.status === "PUBLISHED" && <Button asChild variant="outline"><Link href={`/help/${a.number}`}><ExternalLink /> {t("viewInHelp")}</Link></Button>}
          {a.canPublish && a.status !== "PUBLISHED" && <StatusButton id={a.id} status="PUBLISHED" label={t("publish")} icon={<Send />} variant="default" />}
          {a.canPublish && a.status === "PUBLISHED" && <StatusButton id={a.id} status="ARCHIVED" label={t("archive")} icon={<Archive />} />}
          {a.canPublish && a.status === "ARCHIVED" && <StatusButton id={a.id} status="DRAFT" label={t("backToDraft")} icon={<Undo2 />} />}
        </div>
      </div>
      {sp.fromTicket === "1" && <Alert variant="success">{t("draftFromTicket")}</Alert>}
      {sp.saved === "1" && <Alert variant="success">{t("draftCreated")}</Alert>}
      {a.canEdit ? (
        <ArticleEditor categories={cats} article={{ id: a.id, title: a.title, summary: a.summary, body: a.body, titleTh: a.titleTh, summaryTh: a.summaryTh, bodyTh: a.bodyTh, type: a.type, visibility: a.visibility, categoryId: a.categoryId, tags: a.tags }} />
      ) : (
        <Card><CardHeader><CardTitle className="text-base">{t("readOnly")}</CardTitle></CardHeader><CardContent><Markdown source={pickLang(a.body, a.bodyTh, locale)} /></CardContent></Card>
      )}
    </div>
  );
}
