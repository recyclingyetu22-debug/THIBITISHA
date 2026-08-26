-- AlterTable
ALTER TABLE "document_texts" ADD COLUMN     "analyzedPageCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "verification_requests" ADD COLUMN     "analyzedPageCount" INTEGER,
ADD COLUMN     "coverageIncomplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pageCount" INTEGER;
