"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Filter, Hand, Inbox, Save, Search, X } from "lucide-react";
import type { ChatFilter, ChatQueueRow, ChatView } from "@/server/services/chat-cases";
import { chatQueueAction, claimChatAction, saveChatFilterAction } from "@/server/actions/chat";
import { useRealtime } from "@/components/realtime/realtime-provider";
import { useFormat } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { ColorBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Opt { id: string; name: string }
export interface ChatFilterOptions {
  categories: (Opt & { children: Opt[] })[]; statuses: (Opt & { kind: string })[]; teams: (Opt & { type: string })[]; branches: Opt[]; myTeamIds: string[];
}
const VIEWS: ChatView[] = ["unclaimed", "mine", "myTeams", "all"];

/** "Claim chat": assigns the conversation to me (and my team). Asks for the team when I am in several. */
export function ClaimChatButton({ ticketId, teams, preferredTeamId, size = "default" }: {
  ticketId: string; teams: Opt[]; preferredTeamId: string | null; size?: "default" | "sm";
}) {
  const t = useTranslations("chatConsole");
  const router = useRouter();
  const [teamId, setTeamId] = useState(preferredTeamId ?? (teams.length === 1 ? teams[0]!.id : ""));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chooseTeam = !preferredTeamId && teams.length > 1;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chooseTeam && (
        <NativeSelect value={teamId} onChange={(e) => setTeamId(e.target.value)} className="h-8 w-44 text-xs" aria-label={t("claimAs")} data-testid="claim-team">
          <option value="">{t("claimAs")}</option>
          {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </NativeSelect>
      )}
      <Button size={size} disabled={pending || (chooseTeam && !teamId)} data-testid="claim-chat"
        onClick={() => start(async () => {
          setError(null);
          const r = await claimChatAction(ticketId, teamId || undefined);
          if (!r.ok) { setError(r.error); return; }
          router.refresh();
        })}><Hand /> {t("claim")}</Button>
      {error && <Alert variant="destructive" className="py-1 text-xs">{error}</Alert>}
    </div>
  );
}

function CheckGroup({ title, items, value, onChange, testid }: { title: string; items: Opt[]; value: string[]; onChange: (v: string[]) => void; testid: string }) {
  return (
    <fieldset className="space-y-1" data-testid={testid}>
      <legend className="mb-1 text-xs font-semibold text-muted-foreground">{title}</legend>
      <div className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
        {items.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-primary" checked={value.includes(o.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} /> {o.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Staff chat queue: views, personal filter (saved as default), live updates and claim. */
export function ChatQueuePanel({ initialFilter, savedFilter, options, initialRows, selected }: {
  initialFilter: ChatFilter; savedFilter: ChatFilter; options: ChatFilterOptions; initialRows: ChatQueueRow[]; selected?: string;
}) {
  const t = useTranslations("chatConsole");
  const fmt = useFormat();
  const [filter, setFilter] = useState<ChatFilter>(initialFilter);
  const [saved, setSaved] = useState<ChatFilter>(savedFilter);
  const [rows, setRows] = useState(initialRows);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, start] = useTransition();
  const seq = useRef(0);

  const load = useCallback((f: ChatFilter, query: string) => {
    const n = ++seq.current;
    start(async () => {
      const r = await chatQueueAction(f, query || undefined);
      if (n === seq.current && r.ok && r.data) setRows(r.data.rows);
    });
  }, []);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const h = setTimeout(() => load(filter, q), 250);
    return () => clearTimeout(h);
  }, [filter, q, load]);

  const refresh = useCallback(() => load(filter, q), [filter, q, load]);
  useRealtime("chat:new", refresh);
  useRealtime("chat:claimed", refresh);
  useRealtime("chat:updated", refresh);
  useRealtime("notify", refresh);
  useRealtime("notify:read", refresh);

  const set = (patch: Partial<ChatFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const activeCount = filter.categoryIds.length + filter.statusIds.length + filter.teamIds.length + filter.branchIds.length + (filter.includeForm ? 1 : 0) + (filter.openOnly ? 0 : 1);
  const isSaved = JSON.stringify(filter) === JSON.stringify(saved);
  const catOpts = options.categories.flatMap((c) => [{ id: c.id, name: c.name }, ...c.children.map((s) => ({ id: s.id, name: `↳ ${s.name}` }))]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chat-queue">
      <div className="space-y-2 border-b p-3">
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1 text-xs" role="tablist">
          {VIEWS.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={filter.view === v} onClick={() => set({ view: v })} data-testid={`queue-view-${v}`}
              className={cn("rounded-md px-1.5 py-1 font-medium", filter.view === v ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t(`view.${v}`)}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-8 pl-8 text-xs" />
          </div>
          <Button type="button" size="sm" variant={activeCount ? "secondary" : "outline"} onClick={() => setOpen((o) => !o)} data-testid="queue-filter-toggle">
            <Filter /> {activeCount ? t("filterCount", { n: activeCount }) : t("filter")}
          </Button>
        </div>
        {open && (
          <div className="space-y-3 rounded-lg border bg-card p-3" data-testid="queue-filter">
            <CheckGroup title={t("categories")} items={catOpts} value={filter.categoryIds} onChange={(v) => set({ categoryIds: v })} testid="filter-categories" />
            <CheckGroup title={t("statuses")} items={options.statuses} value={filter.statusIds} onChange={(v) => set({ statusIds: v })} testid="filter-statuses" />
            <CheckGroup title={t("teams")} items={options.teams} value={filter.teamIds} onChange={(v) => set({ teamIds: v })} testid="filter-teams" />
            <CheckGroup title={t("branches")} items={options.branches} value={filter.branchIds} onChange={(v) => set({ branchIds: v })} testid="filter-branches" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={filter.openOnly} onChange={(e) => set({ openOnly: e.target.checked })} /> {t("openOnly")}</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={filter.includeForm} onChange={(e) => set({ includeForm: e.target.checked })} /> {t("includeForm")}</label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={isSaved} data-testid="queue-filter-save"
                onClick={() => start(async () => { const r = await saveChatFilterAction(filter); if (r.ok) { setSaved(filter); setMsg(t("savedDefault")); } else setMsg(r.error); })}>
                <Save /> {t("saveDefault")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setFilter(saved)}>{t("useDefault")}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setFilter({ ...filter, categoryIds: [], statusIds: [], teamIds: [], branchIds: [], openOnly: true, includeForm: false })}><X /> {t("clear")}</Button>
            </div>
            {msg && <p className="text-xs text-muted-foreground" data-testid="queue-filter-msg">{msg}</p>}
          </div>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="queue-list">
        {rows.length === 0 && (
          <li className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground"><Inbox className="size-6" /> {t("empty")}</li>
        )}
        {rows.map((r) => (
          <li key={r.ticketId}>
            <Link href={`/admin/chat?t=${encodeURIComponent(r.number)}`} data-testid="queue-item"
              className={cn("block border-b px-3 py-2.5 hover:bg-accent", selected === r.number && "bg-primary/5", r.unclaimed && "border-l-2 border-l-amber-500")}>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-primary">{r.number}</span>
                <ColorBadge color={r.status.color}>{r.status.name}</ColorBadge>
                {r.unclaimed && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{t("unclaimed")}</span>}
                <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">{r.unclaimed ? t("waiting", { time: fmt.aging(r.createdAt) }) : fmt.time(r.lastAt)}</span>
                {r.unread > 0 && <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white" data-testid="queue-unread">{r.unread}</span>}
              </div>
              <p className="truncate text-sm font-medium">{r.subject}</p>
              <p className="truncate text-[11px] text-muted-foreground">{r.requester} · {r.category}{r.branch ? ` · ${r.branch}` : ""}{r.team ? ` · ${r.team}` : ""}</p>
              {r.preview && <p className="truncate text-xs text-muted-foreground">{r.lastSender ? `${r.lastSender}: ` : ""}{r.preview}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
