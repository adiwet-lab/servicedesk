import { requireAdminPortal } from "@/server/auth/get-actor";
import { TicketDetail } from "@/components/tickets/ticket-detail";

export const metadata = { title: "Ticket" };

export default async function AdminTicketPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ task?: string }> }) {
  const actor = await requireAdminPortal();
  const { number } = await params;
  const sp = await searchParams;
  return <TicketDetail actor={actor} idOrNumber={number} backHref="/admin/tickets" initialTab={sp.task ? "tasks" : undefined} />;
}
