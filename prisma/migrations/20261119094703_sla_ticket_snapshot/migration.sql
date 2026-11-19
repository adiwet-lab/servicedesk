-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "resolutionTargetMin" INTEGER,
ADD COLUMN     "responseTargetMin" INTEGER,
ADD COLUMN     "slaBusinessHours" BOOLEAN NOT NULL DEFAULT true;
