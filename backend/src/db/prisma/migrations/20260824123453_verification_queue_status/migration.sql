-- AlterTable
ALTER TABLE "verification_requests" ADD COLUMN     "currentReviewStatus" "ReviewDecisionStatus";

-- CreateIndex
CREATE INDEX "verification_requests_organizationId_currentReviewStatus_idx" ON "verification_requests"("organizationId", "currentReviewStatus");
