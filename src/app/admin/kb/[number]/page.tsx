import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Archive, Send, Undo2, ExternalLink } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { NotFoundError } from "@/server/authz/errors";
import { getArticle, kbOptions, KB_STATUS_LABEL, requireKbManager } from "@/server/services/kb";
import { setArticleStatusAction } from "@/server/actions/kb";
import { ArticleEditor } from "@/components/kb/kb-client";
import { Markdown } from "@/components/kb/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

function StatusButton({ id, status, label, icon, variant = "outline" }: { id: string; status: string; label: string; icon: React.ReactNode; variant?: "default" | "outline" }) {
  return (
    <form action={setArticleStatusAction}>
      <input type="hidden" name="articleId" value={id} /><input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant} data-testid={`kb-${status.toLowerCase()}`}>{icon} {label}</Button>
    </form>
  );
}

export default async function ArticleAdminPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ saved?: string; fromTicket?: string }> }) {
  const actor = await requireAdminPortal();
  try { requireKbManager(actor); } catch { notFound(); }
  const { number } = await params;
  const sp = await searchParams;
  let a;
  try { a = await getArticle(actor, decodeURIComponent(number), { management: true }); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const cats = await kbOptions();
  return (
    <div className="space-y-5">
      <Link href="/admin/kb" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Knowledge Base</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><span className="font-mono text-sm font-semibold text-primary" data-testid="kb-number">{a.number}</span>
            <Badge variant={a.status === "PUBLISHED" ? "success" : "secondary"} data-testid="kb-status">{KB_STATUS_LABEL[a.status]}</Badge>
            <span className="text-xs text-muted-foreground">v{a.version}</span></div>
          <h1 className="mt-1 text-xl font-semibold">{a.title}</h1>
          <p className="text-xs text-muted-foreground">By {a.author.displayName}{a.updatedBy ? ` · last edited by ${a.updatedBy.displayName}` : ""} · {formatDateTime(a.updatedAt)}
            {a.sourceTicket && <> · from ticket <Link className="text-primary hover:underline" href={`/admin/tickets/${a.sourceTicket.number}`}>{a.sourceTicket.number}</Link></>}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.status === "PUBLISHED" && <Button asChild variant="outline"><Link href={`/help/${a.number}`}><ExternalLink /> View in Help Center</Link></Button>}
          {a.canPublish && a.status !== "PUBLISHED" && <StatusButton id={a.id} status="PUBLISHED" label="Publish" icon={<Send />} variant="default" />}
          {a.canPublish && a.status === "PUBLISHED" && <StatusButton id={a.id} status="ARCHIVED" label="Archive" icon={<Archive />} />}
          {a.canPublish && a.status === "ARCHIVED" && <StatusButton id={a.id} status="DRAFT" label="Back to draft" icon={<Undo2 />} />}
        </div>
      </div>
      {sp.fromTicket === "1" && <Alert variant="success">Draft created from the ticket. Review the text — remove personal or internal details — then save. It is support-only until you change the visibility.</Alert>}
      {sp.saved === "1" && <Alert variant="success">Draft created.</Alert>}
      {a.canEdit ? (
        <ArticleEditor categories={cats} article={{ id: a.id, title: a.title, summary: a.summary, body: a.body, type: a.type, visibility: a.visibility, categoryId: a.categoryId, tags: a.tags }} />
      ) : (
        <Card><CardHeader><CardTitle className="text-base">Read-only — only publishers can edit published or archived articles</CardTitle></CardHeader><CardContent><Markdown source={a.body} /></CardContent></Card>
      )}
    </div>
  );
}
