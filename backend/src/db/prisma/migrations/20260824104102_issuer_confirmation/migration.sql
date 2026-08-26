-- CreateEnum
CREATE TYPE "IssuerConfirmationStatus" AS ENUM ('REQUESTED', 'CONFIRMED_GENUINE', 'CONFIRMED_MODIFIED', 'DENIED_ISSUANCE', 'UNREACHABLE', 'DECLINED_TO_CONFIRM');

-- CreateTable
CREATE TABLE "issuer_confirmation_events" (
    "id" TEXT NOT NULL,
    "verificationRequestId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "IssuerConfirmationStatus" NOT NULL,
    "recordedById" TEXT NOT NULL,
    "contactMethod" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issuer_confirmation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issuer_confirmation_events_verificationRequestId_createdAt_idx" ON "issuer_confirmation_events"("verificationRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "issuer_confirmation_events" ADD CONSTRAINT "issuer_confirmation_events_verificationRequestId_fkey" FOREIGN KEY ("verificationRequestId") REFERENCES "verification_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issuer_confirmation_events" ADD CONSTRAINT "issuer_confirmation_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issuer_confirmation_events" ADD CONSTRAINT "issuer_confirmation_events_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
