import { requireAdminPortal } from "@/server/auth/get-actor";
import { TicketDetail } from "@/components/tickets/ticket-detail";

export const metadata = { title: "Ticket" };

export default async function AdminTicketPage({ params }: { params: Promise<{ number: string }> }) {
  const actor = await requireAdminPortal();
  const { number } = await params;
  return <TicketDetail actor={actor} idOrNumber={number} backHref="/admin/tickets" />;
}
