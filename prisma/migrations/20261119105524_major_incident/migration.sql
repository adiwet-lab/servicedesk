-- CreateEnum
CREATE TYPE "MajorIncidentStatus" AS ENUM ('INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "impactedUserCount" INTEGER,
ADD COLUMN     "majorDeclaredAt" TIMESTAMP(3),
ADD COLUMN     "majorDeclaredById" TEXT,
ADD COLUMN     "majorIncidentStatus" "MajorIncidentStatus";

-- CreateTable
CREATE TABLE "TicketImpactedBranch" (
    "ticketId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketImpactedBranch_pkey" PRIMARY KEY ("ticketId","branchId")
);

-- CreateTable
CREATE TABLE "IncidentUpdate" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "status" "MajorIncidentStatus" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketImpactedBranch_branchId_idx" ON "TicketImpactedBranch"("branchId");

-- CreateIndex
CREATE INDEX "IncidentUpdate_ticketId_createdAt_idx" ON "IncidentUpdate"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_isMajorIncident_majorIncidentStatus_idx" ON "Ticket"("isMajorIncident", "majorIncidentStatus");

-- CreateIndex
CREATE INDEX "Ticket_parentIncidentId_idx" ON "Ticket"("parentIncidentId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_majorDeclaredById_fkey" FOREIGN KEY ("majorDeclaredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketImpactedBranch" ADD CONSTRAINT "TicketImpactedBranch_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketImpactedBranch" ADD CONSTRAINT "TicketImpactedBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
