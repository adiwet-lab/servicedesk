import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireActor } from "@/server/auth/get-actor";
import { NotFoundError } from "@/server/authz/errors";
import { getArticle, KB_TYPE_LABEL } from "@/server/services/kb";
import { Markdown } from "@/components/kb/markdown";
import { FeedbackBox } from "@/components/kb/kb-client";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

export default async function ArticlePage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ solved?: string }> }) {
  const actor = await requireActor();
  const { number } = await params;
  const sp = await searchParams;
  let a;
  try { a = await getArticle(actor, decodeURIComponent(number), { countView: true }); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/help" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Help Center</Link>
      {sp.solved === "1" && <Alert variant="success">Great — glad this solved it. No ticket was created.</Alert>}
      <div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{a.number}</span><Badge variant="secondary">{KB_TYPE_LABEL[a.type]}</Badge>
          {a.visibility === "SUPPORT_ONLY" && <Badge variant="warning">Support only</Badge>}
          {a.category && <span>{a.category.parent ? `${a.category.parent.name} › ` : ""}{a.category.name}</span>}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight" data-testid="kb-title">{a.title}</h1>
        {a.summary && <p className="mt-1 text-muted-foreground">{a.summary}</p>}
        <p className="mt-1 text-xs text-muted-foreground">Updated {formatDateTime(a.updatedAt)} · {a.viewCount + 1} views</p>
      </div>
      <Card><CardContent className="pt-5"><Markdown source={a.body} /></CardContent></Card>
      <FeedbackBox articleId={a.id} mine={a.myFeedback} />
      <p className="text-sm text-muted-foreground">Still need help? <Link href="/tickets/new" className="text-primary hover:underline">Create a ticket</Link>.</p>
    </div>
  );
}
