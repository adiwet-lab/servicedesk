"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { FileText, Lock, Paperclip, Search, Send, X } from "lucide-react";
import type { ChatMessageDto } from "@/server/services/messages";
import { fetchMessagesAction, markTicketReadAction, postMessageAction, ticketUnreadAction } from "@/server/actions/messages";
import { useRealtime, useRealtimeContext, useTicketChannel } from "@/components/realtime/realtime-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Alert, Avatar } from "@/components/ui/misc";
import { cn, formatBytes, formatDateTime } from "@/lib/utils";

export interface ChatPerms { canPostPublic: boolean; canPostInternal: boolean; canReadInternal: boolean; closed: boolean }

function Highlight({ text, q }: { text: string; q?: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="rounded bg-warning/40 px-0.5">{text.slice(i, i + q.length)}</mark><Highlight text={text.slice(i + q.length)} q={q} /></>;
}

function MessageBubble({ m, q }: { m: ChatMessageDto; q?: string }) {
  const internal = m.type === "INTERNAL";
  return (
    <li className={cn("flex gap-3", m.mine && "flex-row-reverse")} data-testid="chat-message" data-type={m.type}>
      <Avatar name={m.sender.name} />
      <div className={cn("max-w-[78%] space-y-1", m.mine && "items-end text-right")}>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{m.sender.name}</span> · {m.sender.role} · {formatDateTime(m.createdAt)}
        </p>
        <div className={cn(
          "inline-block rounded-xl px-3.5 py-2 text-left text-sm",
          internal ? "border border-dashed border-amber-500/60 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
            : m.mine ? "bg-primary text-primary-foreground" : "bg-muted",
        )}>
          {internal && <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300"><Lock className="size-3" /> Internal note — not visible to requester</p>}
          {m.body && <p className="whitespace-pre-wrap break-words"><Highlight text={m.body} q={q} /></p>}
          {m.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {m.attachments.map((a) => a.image ? (
                <a key={a.id} href={`/api/attachments/${a.id}`} title={a.fileName}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/attachments/${a.id}?inline=1`} alt={a.fileName} className="max-h-40 max-w-56 rounded-md border bg-card object-contain" data-testid="chat-image" />
                </a>
              ) : (
                <a key={a.id} href={`/api/attachments/${a.id}`} className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs", m.mine && !internal ? "border-white/30" : "bg-card")}>
                  <FileText className="size-3.5" /> {a.fileName} <span className="opacity-70">{formatBytes(a.sizeBytes)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
        {m.mine && m.seenBy.length > 0 && <p className="text-[11px] text-muted-foreground" data-testid="seen-by">Seen by {m.seenBy.join(", ")}</p>}
      </div>
    </li>
  );
}

export function TicketChat({ ticketId, perms, initial, maxFileSizeMb, allowedExtensions }: {
  ticketId: string; perms: ChatPerms; initial: { messages: ChatMessageDto[]; hasMore: boolean };
  maxFileSizeMb: number; allowedExtensions: string[];
}) {
  const [messages, setMessages] = useState(initial.messages);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [searchQ, setSearchQ] = useState("");
  const [results, setResults] = useState<ChatMessageDto[] | null>(null);
  const [type, setType] = useState<"PUBLIC" | "INTERNAL">("PUBLIC");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { refreshBadges } = useRealtimeContext();
  useTicketChannel(ticketId);

  const merge = useCallback((incoming: ChatMessageDto[]) => {
    setMessages((cur) => {
      const map = new Map(cur.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      return [...map.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
    });
  }, []);

  const markRead = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    markTicketReadAction(ticketId).then(() => refreshBadges()).catch(() => {});
  }, [ticketId, refreshBadges]);

  const fetchNew = useCallback(async () => {
    const last = messages[messages.length - 1];
    const r = await fetchMessagesAction(ticketId, last ? { after: last.id } : {});
    if (r.ok && r.data) merge(r.data.messages);
  }, [messages, ticketId, merge]);

  // Live updates
  useRealtime<{ ticketId: string }>("message:new", (p) => {
    if (p.ticketId !== ticketId) return;
    void fetchNew().then(markRead);
  });
  useRealtime<{ ticketId: string }>("message:read", async (p) => {
    if (p.ticketId !== ticketId) return;
    const r = await fetchMessagesAction(ticketId);
    if (r.ok && r.data) merge(r.data.messages); // refresh "Seen by"
  });

  useEffect(() => {
    markRead();
    const onVis = () => markRead();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [markRead]);

  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => { if (!results) bottomRef.current?.scrollIntoView({ block: "nearest" }); }, [lastId, results]);

  async function loadEarlier() {
    const first = messages[0];
    if (!first) return;
    const r = await fetchMessagesAction(ticketId, { before: first.id });
    if (r.ok && r.data) { merge(r.data.messages); setHasMore(r.data.hasMore); }
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQ.trim()) { setResults(null); return; }
    const r = await fetchMessagesAction(ticketId, { q: searchQ.trim() });
    if (r.ok && r.data) setResults(r.data.messages);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    const tooBig = files.find((f) => f.size > maxFileSizeMb * 1024 * 1024);
    if (tooBig) { setError(`"${tooBig.name}" exceeds ${maxFileSizeMb} MB.`); return; }
    fd.set("type", type);
    startSend(async () => {
      const r = await postMessageAction(null, fd);
      if (!r.ok) { setError(r.error); return; }
      // Clear only what was sent (text typed meanwhile is kept).
      const ta = form.elements.namedItem("body") as HTMLTextAreaElement | null;
      if (ta && ta.value === fd.get("body")) ta.value = "";
      const fi = form.elements.namedItem("attachments") as HTMLInputElement | null;
      if (fi) fi.value = "";
      setFiles([]);
      await fetchNew();
    });
  }

  const canPost = perms.canPostPublic || perms.canPostInternal;
  const shown = results ?? messages;

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <form onSubmit={runSearch} className="flex gap-2" role="search">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search this conversation…" className="pl-9" aria-label="Search chat" data-testid="chat-search" />
          </div>
          <Button type="submit" variant="secondary">Search</Button>
          {results && <Button type="button" variant="ghost" onClick={() => { setResults(null); setSearchQ(""); }}><X /> Clear</Button>}
        </form>
        {results && <p className="text-sm text-muted-foreground" data-testid="chat-search-count">{results.length} message(s) match “{searchQ}”.</p>}

        <div className="max-h-[32rem] overflow-y-auto rounded-lg border bg-background/50 p-4" data-testid="chat-log">
          {!results && hasMore && (
            <div className="mb-3 text-center"><Button variant="ghost" size="sm" onClick={loadEarlier}>Load earlier messages</Button></div>
          )}
          {shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{results ? "No matching messages." : "No messages yet. Start the conversation below."}</p>
          ) : (
            <ul className="space-y-4">{shown.map((m) => <MessageBubble key={m.id} m={m} q={results ? searchQ : undefined} />)}</ul>
          )}
          <div ref={bottomRef} />
        </div>

        {canPost ? (
          <form ref={formRef} onSubmit={onSubmit} className={cn("space-y-2 rounded-lg border p-3", type === "INTERNAL" && "border-dashed border-amber-500/70 bg-amber-50/50 dark:bg-amber-950/20")}>
            <input type="hidden" name="ticketId" value={ticketId} />
            {error && <Alert variant="destructive">{error}</Alert>}
            {perms.canPostInternal && (
              <div className="flex gap-1" role="radiogroup" aria-label="Message type">
                {perms.canPostPublic && (
                  <button type="button" role="radio" aria-checked={type === "PUBLIC"} onClick={() => setType("PUBLIC")}
                    className={cn("rounded-md px-3 py-1 text-xs font-medium", type === "PUBLIC" ? "bg-primary text-primary-foreground" : "hover:bg-accent")} data-testid="chat-type-public">Public reply</button>
                )}
                <button type="button" role="radio" aria-checked={type === "INTERNAL"} onClick={() => setType("INTERNAL")}
                  className={cn("flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium", type === "INTERNAL" ? "bg-amber-500 text-white" : "hover:bg-accent")} data-testid="chat-type-internal"><Lock className="size-3" /> Internal note</button>
              </div>
            )}
            <Textarea name="body" rows={3} maxLength={10000} placeholder={type === "INTERNAL" ? "Internal note — visible to support staff only…" : "Write a message… (Ctrl+Enter to send)"}
              aria-label="Message" data-testid="chat-input"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); formRef.current?.requestSubmit(); } }} />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent">
                <Paperclip className="size-3.5" /> Attach
                <input type="file" name="attachments" multiple className="sr-only" accept={allowedExtensions.map((e) => `.${e}`).join(",")}
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))} data-testid="chat-file" />
              </label>
              <span className="flex-1 truncate text-xs text-muted-foreground">
                {files.length ? files.map((f) => f.name).join(", ") : `Images & files up to ${maxFileSizeMb} MB`}
              </span>
              <Button type="submit" disabled={sending} data-testid="chat-send"><Send /> {sending ? "Sending…" : type === "INTERNAL" ? "Add note" : "Send"}</Button>
            </div>
          </form>
        ) : (
          <Alert>{perms.closed ? "This ticket is closed — the conversation is read-only." : "You can follow this conversation but only the requester and support team can post."}</Alert>
        )}
      </CardContent>
    </Card>
  );
}

/** Live unread counter for the Chat tab label. */
export function ChatTabBadge({ ticketId, initial }: { ticketId: string; initial: number }) {
  const [n, setN] = useState(initial);
  const refresh = useCallback(() => { ticketUnreadAction(ticketId).then(setN).catch(() => {}); }, [ticketId]);
  useRealtime<{ ticketId: string }>("message:new", (p) => { if (p.ticketId === ticketId) setTimeout(refresh, 400); });
  useRealtime("notify:read", refresh);
  if (n <= 0) return null;
  return <span className="ml-1 rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white" data-testid="chat-unread">{n}</span>;
}
