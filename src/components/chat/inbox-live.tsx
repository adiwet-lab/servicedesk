"use client";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/components/realtime/realtime-provider";

/** Refreshes the page (inbox / notifications) when a notification arrives or items are read elsewhere. */
export function InboxLiveRefresh() {
  const router = useRouter();
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = () => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => router.refresh(), 300);
  };
  useRealtime<{ type: string }>("notify", () => refresh());
  useRealtime("notify:read", refresh);
  return null;
}
