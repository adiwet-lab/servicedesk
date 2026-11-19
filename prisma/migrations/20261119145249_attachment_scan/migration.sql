-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('NOT_SCANNED', 'PENDING', 'CLEAN', 'INFECTED');

-- AlterTable
ALTER TABLE "TicketAttachment" ADD COLUMN     "scanStatus" "ScanStatus" NOT NULL DEFAULT 'NOT_SCANNED',
ADD COLUMN     "scannedAt" TIMESTAMP(3);
