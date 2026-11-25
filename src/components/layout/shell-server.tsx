import { Suspense } from "react";
import { prisma } from "@/server/db";
import { signOut } from "@/server/auth/auth";
import type { Actor } from "@/server/authz/actor";
import { unreadCount } from "@/server/services/notifications";
import { totalUnreadMessages } from "@/server/services/messages";
import { AppShell } from "./app-shell";
import { adminNav, canAccessAdminPortal, portalNav } from "./nav";
import { canAny } from "@/server/authz/guards";
import { PERMISSIONS as P } from "@/server/authz/permissions";

export async function Shell({ actor, portal, children }: { actor: Actor; portal: "user" | "admin"; children: React.ReactNode }) {
  const [unread, unreadMessages, roles, tenant] = await Promise.all([
    unreadCount(prisma, actor),
    totalUnreadMessages(actor),
    prisma.role.findMany({ where: { code: { in: actor.roleCodes } }, select: { code: true, name: true } }),
    prisma.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true } }),
  ]);
  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }
  return (
    <Suspense>
      <AppShell
        nav={portal === "admin" ? adminNav(actor) : portalNav(actor)}
        user={{ name: actor.displayName, email: actor.email, roles: roles.map((r) => ({ code: r.code, name: r.name })), tenant: tenant?.name ?? "", vendor: actor.tenantType === "VENDOR" }}
        unread={unread}
        unreadMessages={unreadMessages}
        portal={portal}
        canSwitch={canAccessAdminPortal(actor) && canAny(actor, [P.TICKET_CREATE, P.TICKET_READ_OWN])}
        signOutAction={signOutAction}
      >
        {children}
      </AppShell>
    </Suspense>
  );
}
