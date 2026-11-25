-- AlterTable
ALTER TABLE "ApprovalStep" ADD COLUMN     "nameTh" TEXT;

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "nameTh" TEXT;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "nameTh" TEXT;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "nameTh" TEXT;

-- AlterTable
ALTER TABLE "KbArticle" ADD COLUMN     "bodyTh" TEXT,
ADD COLUMN     "summaryTh" TEXT,
ADD COLUMN     "titleTh" TEXT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "nameTh" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "key" TEXT,
ADD COLUMN     "params" JSONB;

-- AlterTable
ALTER TABLE "Priority" ADD COLUMN     "nameTh" TEXT;

-- AlterTable
ALTER TABLE "SupportTeam" ADD COLUMN     "nameTh" TEXT;

-- AlterTable
ALTER TABLE "TicketStatus" ADD COLUMN     "nameTh" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "locale" TEXT;

-- Full-text search over both languages (replaces the English-only index)
DROP INDEX IF EXISTS "KbArticle_fts_idx";
CREATE INDEX "KbArticle_fts_idx" ON "KbArticle"
  USING GIN (to_tsvector('simple',
    coalesce("title", '') || ' ' || coalesce("summary", '') || ' ' || coalesce("body", '') || ' ' ||
    coalesce("titleTh", '') || ' ' || coalesce("summaryTh", '') || ' ' || coalesce("bodyTh", '')));
