-- CreateEnum
CREATE TYPE "TextExtractionMethod" AS ENUM ('DIRECT', 'OCR');

-- CreateEnum
CREATE TYPE "VerificationRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "VerificationAssessmentStatus" AS ENUM ('LOW_CONCERN', 'SUSPICIOUS', 'HIGH_RISK', 'INCONCLUSIVE', 'VERIFIED_MATCH', 'MODIFIED');

-- CreateEnum
CREATE TYPE "FindingCategory" AS ENUM ('FILE_INTEGRITY', 'PDF_STRUCTURE', 'TEXT_CONSISTENCY', 'IMAGE_SIGNAL', 'AI_INDICATOR', 'REFERENCE_COMPARISON');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "document_texts" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "extractionMethod" "TextExtractionMethod" NOT NULL,
    "text" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "referenceDocumentId" TEXT,
    "status" "VerificationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_findings" (
    "id" TEXT NOT NULL,
    "verificationRequestId" TEXT NOT NULL,
    "category" "FindingCategory" NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "description" TEXT NOT NULL,
    "evidence" JSONB,
    "page" INTEGER,
    "module" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_assessments" (
    "id" TEXT NOT NULL,
    "verificationRequestId" TEXT NOT NULL,
    "status" "VerificationAssessmentStatus" NOT NULL,
    "summary" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_texts_sha256_key" ON "document_texts"("sha256");

-- CreateIndex
CREATE INDEX "verification_requests_organizationId_createdAt_idx" ON "verification_requests"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "verification_findings_verificationRequestId_idx" ON "verification_findings"("verificationRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "verification_assessments_verificationRequestId_key" ON "verification_assessments"("verificationRequestId");

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_referenceDocumentId_fkey" FOREIGN KEY ("referenceDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_findings" ADD CONSTRAINT "verification_findings_verificationRequestId_fkey" FOREIGN KEY ("verificationRequestId") REFERENCES "verification_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_assessments" ADD CONSTRAINT "verification_assessments_verificationRequestId_fkey" FOREIGN KEY ("verificationRequestId") REFERENCES "verification_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
