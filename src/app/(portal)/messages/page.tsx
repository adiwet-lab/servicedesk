import { redirect } from "next/navigation";

/** The Messages inbox became the chat (Phase 9). Kept for old links and notifications. */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const p = await searchParams;
  redirect(p.t ? `/chat?t=${encodeURIComponent(p.t)}` : "/chat");
}
