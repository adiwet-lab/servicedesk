"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bot, ChevronRight, FileText, MessageSquarePlus, Paperclip, RotateCcw, Search, Send } from "lucide-react";
import { startChatCaseAction } from "@/server/actions/chat";
import { SuggestedArticles } from "@/components/kb/kb-client";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { ColorBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Opt { id: string; name: string }
interface Cat extends Opt { requiredFields: string[]; children: (Opt & { requiredFields: string[] })[] }
interface Branch extends Opt { locations: Opt[] }
export interface ChatStartOptions {
  categories: Cat[]; branches: Branch[]; myBranchId: string | null;
  maxFileSizeMb: number; maxFiles: number; allowedExtensions: string[];
}
export interface FollowUp { id: string; number: string; subject: string; status: { name: string; color: string }; unread: number }

const TEXT_FIELDS = ["contactNumber", "relatedAsset", "affectedSystem", "affectedUsers"] as const;
type Step = "welcome" | "follow" | "category" | "subcategory" | "branch" | "extra" | "details";

/** A bot bubble (left) or the user's answer (right). */
export function Bubble({ from, children, testid }: { from: "bot" | "me"; children: React.ReactNode; testid?: string }) {
  return (
    <li className={cn("flex items-end gap-2", from === "me" && "flex-row-reverse")} data-testid={testid}>
      {from === "bot" && <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Bot className="size-4" /></span>}
      <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm", from === "bot" ? "rounded-bl-sm bg-muted" : "rounded-br-sm bg-primary text-primary-foreground")}>{children}</div>
    </li>
  );
}

function Chips({ items, onPick, testid }: { items: Opt[]; onPick: (o: Opt) => void; testid: string }) {
  return (
    <div className="flex flex-wrap gap-2 pl-10" data-testid={testid}>
      {items.map((o) => (
        <Button key={o.id} type="button" size="sm" variant="outline" className="rounded-full border-primary/40 text-primary hover:bg-primary/10" onClick={() => onPick(o)}>{o.name}</Button>
      ))}
    </div>
  );
}

/** Guided start of a conversation: new case (category → subcategory → branch → details) or follow up an open case. */
export function ChatStart({ options, followUps, userName, initial = "welcome" }: {
  options: ChatStartOptions; followUps: FollowUp[]; userName: string; initial?: "welcome" | "new" | "follow";
}) {
  const t = useTranslations("chatFlow");
  const router = useRouter();
  const [step, setStep] = useState<Step>(initial === "new" ? "category" : initial === "follow" ? "follow" : "welcome");
  const [mode, setMode] = useState<"new" | "follow" | null>(initial === "welcome" ? null : initial);
  const [cat, setCat] = useState<Cat | null>(null);
  const [sub, setSub] = useState<(Opt & { requiredFields: string[] }) | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [otherBranch, setOtherBranch] = useState(false);
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const required = useMemo(() => new Set([...(cat?.requiredFields ?? []), ...(sub?.requiredFields ?? [])]), [cat, sub]);
  const needsExtra = TEXT_FIELDS.some((f) => required.has(f)) || required.has("locationId");
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [step, cat, sub, branch]);

  const branches = options.branches;
  const quickBranches = branches.slice(0, 6);
  const filteredBranches = branches.filter((b) => b.name.toLowerCase().includes(filter.toLowerCase()));

  function restart() {
    setStep("welcome"); setMode(null); setCat(null); setSub(null); setBranch(null); setExtra({}); setBody(""); setFiles([]); setError(null); setOtherBranch(false);
  }
  function pickCategory(o: Opt) {
    const c = options.categories.find((x) => x.id === o.id)!;
    setCat(c); setSub(null);
    setStep(c.children.length ? "subcategory" : "branch");
  }
  function pickSub(o: Opt) { setSub(cat!.children.find((x) => x.id === o.id)!); setStep("branch"); }
  function pickBranch(o: Opt) { setBranch(branches.find((b) => b.id === o.id)!); setOtherBranch(false); setStep(needsExtra ? "extra" : "details"); }

  function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (pending || step !== "details" || !cat) return;
    if (!body.trim() && !files.length) { setError(t("typeDetails")); return; }
    if (required.has("attachments") && !files.length) { setError(t("attachmentRequired")); return; }
    const tooBig = files.find((f) => f.size > options.maxFileSizeMb * 1024 * 1024);
    if (tooBig) { setError(t("fileTooBig", { name: tooBig.name, mb: options.maxFileSizeMb })); return; }
    const fd = new FormData();
    fd.set("categoryId", cat.id);
    if (sub) fd.set("subcategoryId", sub.id);
    if (branch) fd.set("branchId", branch.id);
    fd.set("body", body);
    for (const [k, v] of Object.entries(extra)) fd.set(`extra.${k}`, v);
    for (const f of files) fd.append("attachments", f);
    setError(null);
    start(async () => {
      const r = await startChatCaseAction(null, fd);
      if (!r.ok) { setError(Object.values(r.fieldErrors ?? {})[0] ?? r.error); return; }
      router.push(`/chat?t=${encodeURIComponent(r.data!.number)}&created=1`);
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chat-start">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ul className="space-y-3">
          <Bubble from="bot" testid="bot-welcome">{t("welcome", { name: userName })}</Bubble>
          {step === "welcome" && (
            <div className="flex flex-wrap gap-2 pl-10">
              <Button type="button" className="rounded-full" onClick={() => { setMode("new"); setStep("category"); }} data-testid="chat-new-case"><MessageSquarePlus /> {t("newCase")}</Button>
              <Button type="button" variant="outline" className="rounded-full" onClick={() => { setMode("follow"); setStep("follow"); }} data-testid="chat-follow-up"><Search /> {t("followUp")}</Button>
            </div>
          )}

          {mode === "follow" && (
            <>
              <Bubble from="me">{t("followUp")}</Bubble>
              {followUps.length ? (
                <>
                  <Bubble from="bot">{t("pickCase")}</Bubble>
                  <div className="space-y-2 pl-10" data-testid="follow-up-list">
                    {followUps.map((f) => (
                      <Link key={f.id} href={`/chat?t=${encodeURIComponent(f.number)}`} className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2 text-sm hover:border-primary/50 hover:bg-accent">
                        <span className="min-w-0 flex-1">
                          <span className="font-mono text-xs text-primary">{f.number}</span>
                          <span className="block truncate font-medium">{f.subject}</span>
                        </span>
                        <ColorBadge color={f.status.color}>{f.status.name}</ColorBadge>
                        {f.unread > 0 && <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white">{f.unread}</span>}
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </Link>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <Bubble from="bot">{t("noOpenCases")}</Bubble>
                  <div className="pl-10"><Button type="button" size="sm" className="rounded-full" onClick={() => { setMode("new"); setStep("category"); }}><MessageSquarePlus /> {t("newCase")}</Button></div>
                </>
              )}
            </>
          )}

          {mode === "new" && (
            <>
              <Bubble from="me">{t("newCase")}</Bubble>
              <Bubble from="bot">{t("pickCategory")}</Bubble>
              {step === "category" ? <Chips items={options.categories} onPick={pickCategory} testid="chat-categories" /> : cat && <Bubble from="me">{cat.name}</Bubble>}

              {cat && cat.children.length > 0 && step !== "category" && (
                <>
                  <Bubble from="bot">{t("pickSubcategory", { category: cat.name })}</Bubble>
                  {step === "subcategory" ? <Chips items={cat.children} onPick={pickSub} testid="chat-subcategories" /> : sub && <Bubble from="me">{sub.name}</Bubble>}
                </>
              )}

              {(step === "branch" || step === "extra" || step === "details") && (
                <>
                  <Bubble from="bot">{t("pickBranch")}</Bubble>
                  {step === "branch" ? (
                    <div className="space-y-2 pl-10">
                      <Chips items={quickBranches} onPick={pickBranch} testid="chat-branches" />
                      {branches.length > quickBranches.length && !otherBranch && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setOtherBranch(true)}>{t("otherBranch")}</Button>
                      )}
                      {otherBranch && (
                        <div className="max-w-sm space-y-2 rounded-xl border bg-card p-2">
                          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("searchBranch")} aria-label={t("searchBranch")} autoFocus />
                          <ul className="max-h-48 overflow-y-auto text-sm">
                            {filteredBranches.map((b) => <li key={b.id}><button type="button" className="w-full rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => pickBranch(b)}>{b.name}</button></li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : branch && <Bubble from="me">{branch.name}</Bubble>}
                </>
              )}

              {step === "extra" && (
                <>
                  <Bubble from="bot">{t("extraIntro")}</Bubble>
                  <form className="ml-10 max-w-md space-y-2 rounded-xl border bg-card p-3" data-testid="chat-extra"
                    onSubmit={(e) => { e.preventDefault(); setStep("details"); }}>
                    {required.has("locationId") && branch && (
                      <label className="block text-sm">{t("field.locationId")}
                        <NativeSelect required value={extra.locationId ?? ""} onChange={(e) => setExtra({ ...extra, locationId: e.target.value })} className="mt-1">
                          <option value="">{t("select")}</option>
                          {branch.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </NativeSelect>
                      </label>
                    )}
                    {TEXT_FIELDS.filter((f) => required.has(f)).map((f) => (
                      <label key={f} className="block text-sm">{t(`field.${f}`)}
                        <Input required value={extra[f] ?? ""} onChange={(e) => setExtra({ ...extra, [f]: e.target.value })} className="mt-1" data-testid={`chat-extra-${f}`} />
                      </label>
                    ))}
                    <Button type="submit" size="sm">{t("next")}</Button>
                  </form>
                </>
              )}

              {step === "details" && (
                <>
                  {needsExtra && <Bubble from="me">{t("extraDone")}</Bubble>}
                  <Bubble from="bot" testid="bot-details">{t("typeDetails")}{required.has("attachments") ? ` ${t("attachmentRequired")}` : ""}</Bubble>
                  {body.trim().length >= 3 && <div className="pl-10"><SuggestedArticles text={body} categoryId={sub?.id ?? cat?.id ?? ""} /></div>}
                </>
              )}
            </>
          )}
        </ul>
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="m-3 mt-0 space-y-2 rounded-xl border bg-card p-2" data-testid="chat-composer">
        {error && <Alert variant="destructive">{error}</Alert>}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 text-xs">{files.map((f) => <span key={f.name} className="flex items-center gap-1 rounded-md border px-2 py-0.5"><FileText className="size-3" /> {f.name}</span>)}</div>
        )}
        <div className="flex items-end gap-2">
          <Button type="button" variant="ghost" size="icon" title={t("attach")} aria-label={t("attach")} disabled={step !== "details"} onClick={() => fileRef.current?.click()}><Paperclip /></Button>
          <input ref={fileRef} type="file" multiple className="sr-only" accept={options.allowedExtensions.map((e) => `.${e}`).join(",")}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, options.maxFiles))} data-testid="chat-start-file" />
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} disabled={step !== "details"} maxLength={20000}
            placeholder={step === "details" ? t("detailsPlaceholder") : t("chooseAbove")} aria-label={t("detailsPlaceholder")} className="min-h-10 flex-1 resize-none"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} data-testid="chat-start-input" />
          <Button type="submit" size="icon" disabled={step !== "details" || pending} aria-label={t("send")} data-testid="chat-start-send"><Send /></Button>
        </div>
        <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
          <span>{t("enterHint")}</span>
          {step !== "welcome" && <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={restart}><RotateCcw className="size-3" /> {t("restart")}</button>}
        </div>
      </form>
    </div>
  );
}
