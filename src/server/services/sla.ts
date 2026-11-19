import type { Prisma, PrismaClient } from "@prisma/client";
import { addBusinessMinutes, addMinutes, type BusinessCalendar, type WeeklySchedule } from "@/server/domain/sla-calendar";

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Resolves the SLA profile and computes response/resolution due dates for a new ticket.
 * Profile precedence: subcategory → category → owner team → default profile.
 */
export async function computeSlaTargets(
  db: Db,
  args: { subcategorySlaProfileId?: string | null; categorySlaProfileId?: string | null; teamId?: string | null; priorityId: string; start: Date },
) {
  let profileId = args.subcategorySlaProfileId ?? args.categorySlaProfileId ?? null;
  if (!profileId && args.teamId) {
    const team = await db.supportTeam.findUnique({ where: { id: args.teamId }, select: { slaProfileId: true } });
    profileId = team?.slaProfileId ?? null;
  }
  const profile = profileId
    ? await db.slaProfile.findFirst({ where: { id: profileId, isActive: true }, include: { businessHours: { include: { holidays: true } } } })
    : await db.slaProfile.findFirst({ where: { isDefault: true, isActive: true }, include: { businessHours: { include: { holidays: true } } } });
  if (!profile) return { slaProfileId: null, responseDueAt: null, resolutionDueAt: null };

  const target = await db.slaTarget.findUnique({
    where: { slaProfileId_priorityId: { slaProfileId: profile.id, priorityId: args.priorityId } },
  });
  if (!target) return { slaProfileId: profile.id, responseDueAt: null, resolutionDueAt: null };

  const bh = profile.businessHours ?? (await db.businessHours.findFirst({ where: { isDefault: true }, include: { holidays: true } }));
  const useCalendar = target.businessHoursOnly && bh;
  const cal: BusinessCalendar | null = useCalendar
    ? {
        timezone: bh.timezone,
        schedule: bh.schedule as WeeklySchedule,
        holidays: bh.holidays.map((h) => h.date.toISOString().slice(0, 10)),
      }
    : null;
  const add = (mins: number) => (cal ? addBusinessMinutes(args.start, mins, cal) : addMinutes(args.start, mins));
  return {
    slaProfileId: profile.id,
    responseDueAt: add(target.responseMinutes),
    resolutionDueAt: add(target.resolutionMinutes),
  };
}
