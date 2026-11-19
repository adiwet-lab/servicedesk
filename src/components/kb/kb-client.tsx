"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { BookOpen, Eye, Save, ThumbsDown, ThumbsUp, Lightbulb, CheckCircle2 } from "lucide-react";
import {
  createArticleAction, createArticleFromTicketAction, deflectAction, feedbackAction, suggestArticlesAction, updateArticleAction,
} from "@/server/actions/kb";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Markdown } from "./markdown";

type Cat = { id: string; name: string; children: { id: string; name: string }[] };
export interface ArticleDraft {
  id?: string; title: string; summary: string; body: string; type: string; visibility: string; categoryId: string | null; tags: string[];
}

export function ArticleEditor({ article, categories, readOnly }: { article?: ArticleDraft; categories: Cat[]; readOnly?: boolean }) {
  const isNew = !article?.id;
  const [state, action, pending] = useActionState(isNew ? createArticleAction : updateArticleAction, null);
  const [body, setBody] = useState(article?.body ?? "");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="grid gap-5 lg:grid-cols-3">
      {article?.id && <input type="hidden" name="articleId" value={article.id} />}
      <div className="space-y-4 lg:col-span-2">
        {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
        {state?.ok && <Alert variant="success">{state.message}</Alert>}
        <Field label="Title" htmlFor="kb-title" required error={fe.title}><Input id="kb-title" name="title" defaultValue={article?.title} maxLength={200} required disabled={readOnly} /></Field>
        <Field label="Summary" htmlFor="kb-summary" error={fe.summary} hint="One or two sentences shown in search results."><Input id="kb-summary" name="summary" defaultValue={article?.summary} maxLength={500} disabled={readOnly} /></Field>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Body</span>
            <div className="ml-auto flex gap-1">
              <Button type="button" size="sm" variant={tab === "write" ? "secondary" : "ghost"} onClick={() => setTab("write")}>Write</Button>
              <Button type="button" size="sm" variant={tab === "preview" ? "secondary" : "ghost"} onClick={() => setTab("preview")} data-testid="kb-preview-tab"><Eye /> Preview</Button>
            </div>
          </div>
          <Textarea id="kb-body" name="body" rows={18} value={body} onChange={(e) => setBody(e.target.value)} maxLength={50000} required disabled={readOnly}
            className={tab === "write" ? "font-mono text-xs" : "hidden"} aria-label="Article body" aria-invalid={!!fe.body} />
          {tab === "preview" && <div className="min-h-64 rounded-md border p-4"><Markdown source={body} /></div>}
          {fe.body && <p className="text-sm text-destructive">{fe.body}</p>}
          <p className="text-xs text-muted-foreground">Formatting: <code># Heading</code>, <code>**bold**</code>, <code>*italic*</code>, <code>`code`</code>, <code>- list</code>, <code>1. steps</code>, <code>&gt; note</code>, <code>[link](https://…)</code>. HTML is shown as text.</p>
        </div>
      </div>
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-4 pt-5">
            <Field label="Type" htmlFor="kb-type"><NativeSelect id="kb-type" name="type" defaultValue={article?.type ?? "FAQ"} disabled={readOnly}>
              <option value="FAQ">FAQ</option><option value="TROUBLESHOOTING">Troubleshooting</option><option value="HOW_TO">How-to</option></NativeSelect></Field>
            <Field label="Visibility" htmlFor="kb-vis" hint="Support-only articles are hidden from employees and vendors."><NativeSelect id="kb-vis" name="visibility" defaultValue={article?.visibility ?? "EMPLOYEES"} disabled={readOnly} data-testid="kb-visibility">
              <option value="EMPLOYEES">Employees (Help Center)</option><option value="SUPPORT_ONLY">Support staff only</option></NativeSelect></Field>
            <Field label="Category" htmlFor="kb-cat" error={fe.categoryId}><NativeSelect id="kb-cat" name="categoryId" defaultValue={article?.categoryId ?? ""} disabled={readOnly}>
              <option value="">—</option>
              {categories.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  <option value={c.id}>{c.name} (all)</option>
                  {c.children.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ))}
            </NativeSelect></Field>
            <Field label="Tags" htmlFor="kb-tags" hint="Comma separated"><Input id="kb-tags" name="tags" defaultValue={article?.tags.join(", ")} disabled={readOnly} /></Field>
            {!isNew && <Field label="Change note" htmlFor="kb-note" hint="Recorded in the audit log"><Input id="kb-note" name="changeNote" maxLength={500} disabled={readOnly} /></Field>}
            {!readOnly && <Button type="submit" className="w-full" disabled={pending} data-testid="kb-save"><Save /> {isNew ? "Create draft" : "Save"}</Button>}
          </CardContent>
        </Card>
      </div>
    </form>
  );
}

export function FeedbackBox({ articleId, mine }: { articleId: string; mine: boolean | null }) {
  const [state, action, pending] = useActionState(feedbackAction, null);
  const [vote, setVote] = useState<boolean | null>(mine);
  return (
    <form action={action} className="space-y-2 rounded-lg border p-4" data-testid="kb-feedback">
      <input type="hidden" name="articleId" value={articleId} />
      <p className="text-sm font-medium">Was this article helpful?</p>
      <div className="flex gap-2">
        <Button type="submit" name="helpful" value="true" size="sm" variant={vote === true ? "default" : "outline"} disabled={pending} onClick={() => setVote(true)} data-testid="kb-helpful-yes"><ThumbsUp /> Yes</Button>
        <Button type="submit" name="helpful" value="false" size="sm" variant={vote === false ? "default" : "outline"} disabled={pending} onClick={() => setVote(false)} data-testid="kb-helpful-no"><ThumbsDown /> No</Button>
      </div>
      {state?.ok && <p className="text-sm text-muted-foreground">{state.message}</p>}
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

export function CreateFromTicketButton({ ticketId }: { ticketId: string }) {
  const [state, action, pending] = useActionState(createArticleFromTicketAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <Button size="sm" variant="outline" type="submit" disabled={pending} data-testid="kb-from-ticket"><BookOpen /> Create knowledge article</Button>
      {state && !state.ok && <p className="mt-1 text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

type Suggestion = Awaited<ReturnType<typeof suggestArticlesAction>>[number];

/** Debounced deflection suggestions shown while an employee types the ticket subject. */
export function SuggestedArticles({ text, categoryId }: { text: string; categoryId: string }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [busy, startTransition] = useTransition();
  const seq = useRef(0);
  useEffect(() => {
    const q = text.trim();
    if (q.length < 3) { setItems([]); return; }
    const n = ++seq.current;
    const h = setTimeout(async () => {
      try {
        const r = await suggestArticlesAction(q, categoryId || undefined);
        if (n === seq.current) setItems(r);
      } catch { /* suggestions are best-effort */ }
    }, 350);
    return () => clearTimeout(h);
  }, [text, categoryId]);
  if (!items.length) return null;
  return (
    <Card className="border-primary/40" data-testid="kb-suggestions">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="size-4 text-primary" /> These articles might solve it</CardTitle>
        <CardDescription>Check them before submitting — you can still create the ticket.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start gap-3 py-2">
              <div className="min-w-0 flex-1">
                <Link href={`/help/${a.number}`} target="_blank" className="font-medium text-primary hover:underline">{a.title}</Link>
                <p className="line-clamp-2 text-xs text-muted-foreground">{a.snippet}</p>
              </div>
              <Button size="sm" variant="ghost" type="button" disabled={busy} data-testid="kb-solved"
                onClick={() => startTransition(async () => { await deflectAction(a.id, a.number); })}><CheckCircle2 /> This solved my problem</Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
