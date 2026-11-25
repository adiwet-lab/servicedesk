import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { Actor } from "@/server/authz/actor";
import { prisma } from "@/server/db";
import { NotFoundError } from "@/server/authz/errors";
import { getTicketDetail } from "@/server/services/tickets";
import { getChatPermissions, listMessages } from "@/server/services/messages";
import { chatCaseHeader } from "@/server/services/chat-cases";
import { getSettings } from "@/server/services/settings";
import { currentLocale } from "@/i18n/server";
import { ln } from "@/lib/localized";
import { ColorBadge } from "@/components/ui/badge";
import { StatusChanger } from "@/components/tickets/ticket-actions";
import { TicketChat } from "./ticket-chat";
import { Bubble } from "./chat-start";

/** One conversation in the chat pages: header, bot notices and the ticket chat (messenger layout). */
export async function CasePane({ actor, ticket, created, backHref, detailHref, staffPanel }: {
  actor: Actor; ticket: string; created?: boolean; backHref: string; detailHref: string; staffPanel?: React.ReactNode;
}) {
  const [t, locale] = await Promise.all([getTranslations("chatFlow"), currentLocale()]);
  let header, detail;
  try {
    [header, detail] = await Promise.all([chatCaseHeader(actor, ticket, locale), getTicketDetail(actor, ticket)]);
  } catch (e) {
    if (e instanceof NotFoundError) return <p className="p-10 text-center text-sm text-muted-foreground" data-testid="chat-not-found">{t("notFound")}</p>;
    throw e;
  }
  const [perms, initial, settings] = await Promise.all([getChatPermissions(actor, header.id), listMessages(actor, header.id), getSettings(prisma)]);
  const isRequester = header.requesterId === actor.id;
  const transitions = detail.allowedTransitions.map((tr) => ({ ...tr, name: ln(tr, locale) }));
  const kind = header.status.kind;

  const notices = (
    <ul className="space-y-3 px-4 pb-3">
      {created && initial.messages.length <= 1 && <Bubble from="bot" testid="bot-created">{header.ownerTeam ? t("created", { number: header.number, team: header.ownerTeam }) : t("createdNoTeam", { number: header.number })}</Bubble>}
      {isRequester && header.approvalStatus === "PENDING" && <Bubble from="bot">{t("pendingApproval")}</Bubble>}
      {isRequester && kind === "RESOLVED" && (
        <>
          <Bubble from="bot" testid="bot-resolved">{t("resolvedAsk")}</Bubble>
          <div className="pl-10"><StatusChanger ticketId={header.id} transitions={transitions} asButtons /></div>
        </>
      )}
      {(kind === "CLOSED" || kind === "CANCELLED") && <Bubble from="bot">{t("closedNote")}</Bubble>}
    </ul>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3" data-testid="case-header">
        <Link href={backHref} className="text-muted-foreground hover:text-foreground md:hidden" aria-label={t("back")}><ArrowLeft className="size-5" /></Link>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono font-medium text-primary">{header.number}</span>
            <ColorBadge color={header.status.color}>{header.status.name}</ColorBadge>
            <span className="text-muted-foreground">{header.category}{header.branch ? ` · ${header.branch}` : ""}</span>
          </p>
          <p className="truncate font-semibold" data-testid="case-subject">{header.subject}</p>
          <p className="text-xs text-muted-foreground">
            {header.unclaimed ? t("waitingAgent") : header.assignedAgent ? t("handledBy", { name: header.assignedAgent.displayName }) : header.ownerTeam}
          </p>
        </div>
        <Link href={detailHref} className="flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink className="size-3.5" /> {t("details")}</Link>
      </div>
      {staffPanel}
      <div className="min-h-0 flex-1">
        <TicketChat key={header.id} ticketId={header.id} perms={perms} initial={initial} variant="messenger" footer={notices}
          maxFileSizeMb={settings["attachments.maxFileSizeMb"]} allowedExtensions={settings["attachments.allowedExtensions"]} />
      </div>
    </div>
  );
}
