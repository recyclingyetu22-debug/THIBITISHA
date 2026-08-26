-- CreateEnum
CREATE TYPE "ReviewDecisionStatus" AS ENUM ('IN_REVIEW', 'CONFIRMED_AUTHENTIC', 'CONFIRMED_MODIFICATION', 'INSUFFICIENT_EVIDENCE', 'REQUEST_MORE_INFORMATION', 'FALSE_POSITIVE');

-- CreateTable
CREATE TABLE "review_events" (
    "id" TEXT NOT NULL,
    "verificationRequestId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "ReviewDecisionStatus" NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_events_verificationRequestId_createdAt_idx" ON "review_events"("verificationRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_verificationRequestId_fkey" FOREIGN KEY ("verificationRequestId") REFERENCES "verification_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
