"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useState } from "react";
import { Bell, X } from "lucide-react";

export interface Toast { id: number; title: string; body?: string | null; href?: string | null }
const ToastCtx = createContext<{ push: (t: Omit<Toast, "id">) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

let seq = 0;
export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq;
    setToasts((list) => [...list.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), 6000);
  }, [dismiss]);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex gap-3 rounded-lg border bg-popover p-3 shadow-lg" data-testid="toast">
            <Bell className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 text-sm">
              {t.href ? <Link href={t.href} className="font-medium hover:underline" onClick={() => dismiss(t.id)}>{t.title}</Link> : <p className="font-medium">{t.title}</p>}
              {t.body && <p className="truncate text-muted-foreground">{t.body}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss"><X className="size-4 text-muted-foreground" /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
