-- CreateEnum
CREATE TYPE "TicketChannel" AS ENUM ('FORM', 'CHAT');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "channel" "TicketChannel" NOT NULL DEFAULT 'FORM';

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId","key")
);

-- CreateIndex
CREATE INDEX "Ticket_channel_assignedAgentId_idx" ON "Ticket"("channel", "assignedAgentId");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
