import { requireActor } from "@/server/auth/get-actor";
import { Shell } from "@/components/layout/shell-server";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  return <Shell actor={actor} portal="user">{children}</Shell>;
}
