"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
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
  id?: string; title: string; summary: string; body: string; titleTh: string | null; summaryTh: string | null; bodyTh: string | null;
  type: string; visibility: string; categoryId: string | null; tags: string[];
}
type Lang = "en" | "th";

/** One language's title/summary/body with write/preview. Thai fields keep Thai labels in both UIs. */
function LangFields({ lang, active, article, readOnly, fe }: { lang: Lang; active: boolean; article?: ArticleDraft; readOnly?: boolean; fe: Record<string, string> }) {
  const tk = useTranslations("kb");
  const [body, setBody] = useState((lang === "en" ? article?.body : article?.bodyTh) ?? "");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const sfx = lang === "th" ? "Th" : "";
  const L = (k: "title" | "summary" | "body") => (lang === "th" ? tk(`fieldTh.${k}`) : tk(`field.${k}`));
  return (
    <div className={active ? "space-y-4" : "hidden"} data-testid={`kb-lang-${lang}`}>
      <Field label={L("title")} htmlFor={`kb-title${sfx}`} error={fe[`title${sfx}`]}><Input id={`kb-title${sfx}`} name={`title${sfx}`} defaultValue={(lang === "en" ? article?.title : article?.titleTh) ?? ""} maxLength={200} disabled={readOnly} /></Field>
      <Field label={L("summary")} htmlFor={`kb-summary${sfx}`} error={fe[`summary${sfx}`]} hint={tk("summaryHint")}><Input id={`kb-summary${sfx}`} name={`summary${sfx}`} defaultValue={(lang === "en" ? article?.summary : article?.summaryTh) ?? ""} maxLength={500} disabled={readOnly} /></Field>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{L("body")}</span>
          <div className="ml-auto flex gap-1">
            <Button type="button" size="sm" variant={tab === "write" ? "secondary" : "ghost"} onClick={() => setTab("write")}>{tk("write")}</Button>
            <Button type="button" size="sm" variant={tab === "preview" ? "secondary" : "ghost"} onClick={() => setTab("preview")} data-testid={lang === "en" ? "kb-preview-tab" : "kb-preview-tab-th"}><Eye /> {tk("preview")}</Button>
          </div>
        </div>
        <Textarea id={`kb-body${sfx}`} name={`body${sfx}`} rows={18} value={body} onChange={(e) => setBody(e.target.value)} maxLength={50000} disabled={readOnly}
          className={tab === "write" ? "font-mono text-xs" : "hidden"} aria-label={L("body")} aria-invalid={!!fe[`body${sfx}`]} />
        {tab === "preview" && <div className="min-h-64 rounded-md border p-4"><Markdown source={body} /></div>}
        {fe[`body${sfx}`] && <p className="text-sm text-destructive">{fe[`body${sfx}`]}</p>}
      </div>
    </div>
  );
}

export function ArticleEditor({ article, categories, readOnly }: { article?: ArticleDraft; categories: Cat[]; readOnly?: boolean }) {
  const tk = useTranslations("kb");
  const locale = useLocale() as Lang;
  const isNew = !article?.id;
  const [state, action, pending] = useActionState(isNew ? createArticleAction : updateArticleAction, null);
  // Start on the UI language, unless only the other language has content.
  const has = (l: Lang) => !!(l === "en" ? article?.title || article?.body : article?.titleTh || article?.bodyTh);
  const [lang, setLang] = useState<Lang>(article && !has(locale) && has(locale === "en" ? "th" : "en") ? (locale === "en" ? "th" : "en") : locale);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="grid gap-5 lg:grid-cols-3">
      {article?.id && <input type="hidden" name="articleId" value={article.id} />}
      <div className="space-y-4 lg:col-span-2">
        {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
        {state?.ok && <Alert variant="success">{state.message}</Alert>}
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={tk("language")}>
          {(["en", "th"] as const).map((l) => (
            <Button key={l} type="button" size="sm" role="tab" aria-selected={lang === l} variant={lang === l ? "default" : "outline"} onClick={() => setLang(l)} data-testid={`kb-tab-${l}`}>
              {l === "en" ? "English" : "ไทย"}{has(l) ? " ✓" : ""}
            </Button>
          ))}
          <span className="text-xs text-muted-foreground">{tk("languageHint")}</span>
        </div>
        <LangFields lang="en" active={lang === "en"} article={article} readOnly={readOnly} fe={fe} />
        <LangFields lang="th" active={lang === "th"} article={article} readOnly={readOnly} fe={fe} />
        <p className="text-xs text-muted-foreground">{tk("formatting")} <code># Heading</code>, <code>**bold**</code>, <code>*italic*</code>, <code>`code`</code>, <code>- list</code>, <code>1. steps</code>, <code>&gt; note</code>, <code>[link](https://…)</code>. {tk("htmlAsText")}</p>
      </div>
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-4 pt-5">
            <Field label={tk("type")} htmlFor="kb-type"><NativeSelect id="kb-type" name="type" defaultValue={article?.type ?? "FAQ"} disabled={readOnly}>
              <option value="FAQ">{tk("kbType.FAQ")}</option><option value="TROUBLESHOOTING">{tk("kbType.TROUBLESHOOTING")}</option><option value="HOW_TO">{tk("kbType.HOW_TO")}</option></NativeSelect></Field>
            <Field label={tk("visibility")} htmlFor="kb-vis" hint={tk("visibilityHint")}><NativeSelect id="kb-vis" name="visibility" defaultValue={article?.visibility ?? "EMPLOYEES"} disabled={readOnly} data-testid="kb-visibility">
              <option value="EMPLOYEES">{tk("visEmployees")}</option><option value="SUPPORT_ONLY">{tk("visSupport")}</option></NativeSelect></Field>
            <Field label={tk("category")} htmlFor="kb-cat" error={fe.categoryId}><NativeSelect id="kb-cat" name="categoryId" defaultValue={article?.categoryId ?? ""} disabled={readOnly}>
              <option value="">—</option>
              {categories.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  <option value={c.id}>{tk("categoryAll", { name: c.name })}</option>
                  {c.children.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ))}
            </NativeSelect></Field>
            <Field label={tk("tags")} htmlFor="kb-tags" hint={tk("tagsHint")}><Input id="kb-tags" name="tags" defaultValue={article?.tags.join(", ")} disabled={readOnly} /></Field>
            {!isNew && <Field label={tk("changeNote")} htmlFor="kb-note" hint={tk("changeNoteHint")}><Input id="kb-note" name="changeNote" maxLength={500} disabled={readOnly} /></Field>}
            {!readOnly && <Button type="submit" className="w-full" disabled={pending} data-testid="kb-save"><Save /> {isNew ? tk("createDraft") : tk("save")}</Button>}
          </CardContent>
        </Card>
      </div>
    </form>
  );
}

export function FeedbackBox({ articleId, mine }: { articleId: string; mine: boolean | null }) {
  const tk = useTranslations("kb");
  const [state, action, pending] = useActionState(feedbackAction, null);
  const [vote, setVote] = useState<boolean | null>(mine);
  return (
    <form action={action} className="space-y-2 rounded-lg border p-4" data-testid="kb-feedback">
      <input type="hidden" name="articleId" value={articleId} />
      <p className="text-sm font-medium">{tk("wasHelpful")}</p>
      <div className="flex gap-2">
        <Button type="submit" name="helpful" value="true" size="sm" variant={vote === true ? "default" : "outline"} disabled={pending} onClick={() => setVote(true)} data-testid="kb-helpful-yes"><ThumbsUp /> {tk("yes")}</Button>
        <Button type="submit" name="helpful" value="false" size="sm" variant={vote === false ? "default" : "outline"} disabled={pending} onClick={() => setVote(false)} data-testid="kb-helpful-no"><ThumbsDown /> {tk("no")}</Button>
      </div>
      {state?.ok && <p className="text-sm text-muted-foreground">{state.message}</p>}
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

export function CreateFromTicketButton({ ticketId }: { ticketId: string }) {
  const tk = useTranslations("kb");
  const [state, action, pending] = useActionState(createArticleFromTicketAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <Button size="sm" variant="outline" type="submit" disabled={pending} data-testid="kb-from-ticket"><BookOpen /> {tk("createArticle")}</Button>
      {state && !state.ok && <p className="mt-1 text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

type Suggestion = Awaited<ReturnType<typeof suggestArticlesAction>>[number];

/** Debounced deflection suggestions shown while an employee types the ticket subject. */
export function SuggestedArticles({ text, categoryId }: { text: string; categoryId: string }) {
  const tk = useTranslations("kb");
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
        <CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="size-4 text-primary" /> {tk("suggestTitle")}</CardTitle>
        <CardDescription>{tk("suggestHint")}</CardDescription>
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
                onClick={() => startTransition(async () => { await deflectAction(a.id, a.number); })}><CheckCircle2 /> {tk("solvedIt")}</Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
