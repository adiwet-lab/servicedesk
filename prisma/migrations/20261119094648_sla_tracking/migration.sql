-- AlterTable
ALTER TABLE "TicketTask" ADD COLUMN     "overdueNotifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SlaEvent_ticketId_clock_type_idx" ON "SlaEvent"("ticketId", "clock", "type");
