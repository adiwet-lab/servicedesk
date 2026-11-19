-- CreateEnum
CREATE TYPE "KbArticleType" AS ENUM ('FAQ', 'TROUBLESHOOTING', 'HOW_TO');

-- CreateEnum
CREATE TYPE "KbVisibility" AS ENUM ('EMPLOYEES', 'SUPPORT_ONLY');

-- CreateEnum
CREATE TYPE "KbStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "KbArticle" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "type" "KbArticleType" NOT NULL DEFAULT 'FAQ',
    "visibility" "KbVisibility" NOT NULL DEFAULT 'EMPLOYEES',
    "status" "KbStatus" NOT NULL DEFAULT 'DRAFT',
    "categoryId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authorId" TEXT NOT NULL,
    "updatedById" TEXT,
    "sourceTicketId" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "helpfulYes" INTEGER NOT NULL DEFAULT 0,
    "helpfulNo" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbArticleTicket" (
    "articleId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "linkedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbArticleTicket_pkey" PRIMARY KEY ("articleId","ticketId")
);

-- CreateTable
CREATE TABLE "KbFeedback" (
    "articleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbFeedback_pkey" PRIMARY KEY ("articleId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "KbArticle_number_key" ON "KbArticle"("number");

-- CreateIndex
CREATE INDEX "KbArticle_status_visibility_idx" ON "KbArticle"("status", "visibility");

-- CreateIndex
CREATE INDEX "KbArticle_categoryId_idx" ON "KbArticle"("categoryId");

-- CreateIndex
CREATE INDEX "KbArticleTicket_ticketId_idx" ON "KbArticleTicket"("ticketId");

-- AddForeignKey
ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_sourceTicketId_fkey" FOREIGN KEY ("sourceTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbArticleTicket" ADD CONSTRAINT "KbArticleTicket_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KbArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbArticleTicket" ADD CONSTRAINT "KbArticleTicket_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbFeedback" ADD CONSTRAINT "KbFeedback_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KbArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbFeedback" ADD CONSTRAINT "KbFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Full-text search (language-neutral 'simple' config; ILIKE fallback in the service covers Thai / partial words)
CREATE INDEX "KbArticle_fts_idx" ON "KbArticle"
  USING GIN (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("summary", '') || ' ' || coalesce("body", '')));

-- Article numbering (KB-000001); admin-editable like the ticket/task sequences
INSERT INTO "NumberSequence" ("key", "prefix", "format", "resetYearly", "year", "current", "updatedAt")
VALUES ('KB', 'KB', '{PREFIX}-{SEQ:6}', false, EXTRACT(YEAR FROM NOW())::int, 0, NOW())
ON CONFLICT ("key") DO NOTHING;
