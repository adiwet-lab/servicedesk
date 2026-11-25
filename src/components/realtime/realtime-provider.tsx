"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { badgeCountsAction } from "@/server/actions/messages";
import { useToast } from "./toaster";
import { useTranslations } from "next-intl";
import { renderNotification } from "@/i18n/notifications";

type Status = "connecting" | "live" | "offline";
interface Badges { notifications: number; messages: number }
interface RealtimeCtx { socket: Socket | null; status: Status; badges: Badges; refreshBadges: () => void }

const Ctx = createContext<RealtimeCtx>({ socket: null, status: "offline", badges: { notifications: 0, messages: 0 }, refreshBadges: () => {} });
export const useRealtimeContext = () => useContext(Ctx);

/**
 * One Socket.IO connection per tab (same origin, session cookie). Server events
 * are signals only; data is re-fetched through authorized server actions.
 */
export function RealtimeProvider({ initialBadges, children }: { initialBadges: Badges; children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [badges, setBadges] = useState(initialBadges);
  const { push } = useToast();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const tn = useTranslations("notify");
  const tnRef = useRef(tn);
  tnRef.current = tn;
  pathRef.current = pathname;

  const refreshBadges = useCallback(() => {
    badgeCountsAction().then(setBadges).catch(() => {});
  }, []);

  useEffect(() => setBadges(initialBadges), [initialBadges]);

  useEffect(() => {
    const s = io({ path: "/socket.io", withCredentials: true, transports: ["websocket", "polling"], reconnectionDelayMax: 10_000 });
    setSocket(s);
    s.on("connect", () => { setStatus("live"); refreshBadges(); });
    s.on("disconnect", () => setStatus("offline"));
    s.io.on("reconnect_attempt", () => setStatus("connecting"));
    s.on("connect_error", (err) => {
      setStatus("offline");
      if (err.message === "unauthorized") s.disconnect();
    });
    s.on("session:revoked", () => { window.location.href = "/login?error=session_revoked"; });
    s.on("notify", (p: { type: string; title: string; key?: string | null; params?: Record<string, string | number> | null; link: string | null; ticketId: string | null }) => {
      refreshBadges();
      // Don't toast chat messages for the conversation currently open.
      const onTicket = p.link && pathRef.current && p.link.split("?")[0]!.endsWith(pathRef.current.split("/").pop() ?? "#");
      if (!(p.type === "NEW_MESSAGE" && onTicket)) {
        const r = renderNotification({ key: p.key ?? null, params: p.params ?? null, title: p.title, body: null }, tnRef.current as never);
        push({ title: r.title, body: r.body, href: p.link });
      }
    });
    s.on("notify:read", refreshBadges);
    return () => { s.removeAllListeners(); s.disconnect(); };
  }, [push, refreshBadges]);

  return <Ctx.Provider value={{ socket, status, badges, refreshBadges }}>{children}</Ctx.Provider>;
}

/** Subscribe to a server event while mounted. */
export function useRealtime<T = unknown>(event: string, handler: (payload: T) => void) {
  const { socket } = useRealtimeContext();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const fn = (p: T) => ref.current(p);
    socket.on(event, fn);
    return () => { socket.off(event, fn); };
  }, [socket, event]);
}

/** Joins the ticket's room(s) while mounted (re-joins after reconnect). */
export function useTicketChannel(ticketId: string) {
  const { socket } = useRealtimeContext();
  const [joined, setJoined] = useState<{ ok: boolean; internal?: boolean } | null>(null);
  useEffect(() => {
    if (!socket) return;
    const join = () => socket.emit("ticket:join", ticketId, (r: { ok: boolean; internal?: boolean }) => setJoined(r));
    if (socket.connected) join();
    socket.on("connect", join);
    return () => { socket.off("connect", join); socket.emit("ticket:leave", ticketId); };
  }, [socket, ticketId]);
  return joined;
}

/** Refreshes server components when the ticket changes elsewhere (status, tasks, assignment…). */
export function TicketLiveRefresh({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  useTicketChannel(ticketId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime<{ ticketId: string }>("ticket:changed", (p) => {
    if (p.ticketId !== ticketId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 300);
  });
  return null;
}

export function LiveIndicator() {
  const t = useTranslations("realtime");
  const { status } = useRealtimeContext();
  const color = status === "live" ? "bg-success" : status === "connecting" ? "bg-warning" : "bg-muted-foreground";
  const label = status === "live" ? t("live") : status === "connecting" ? t("connecting") : t("offline");
  return (
    <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex" title={t("realtimeStatus", { status: label })} data-testid="live-indicator" data-status={status}>
      <span className={`size-2 rounded-full ${color}`} /> {label}
    </span>
  );
}
