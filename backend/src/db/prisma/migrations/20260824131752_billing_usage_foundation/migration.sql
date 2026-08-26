-- CreateEnum
CREATE TYPE "PlanCategory" AS ENUM ('INDIVIDUAL_FREE', 'INDIVIDUAL_PAID', 'ORGANIZATION', 'ENTERPRISE', 'API');

-- CreateEnum
CREATE TYPE "ClientPlatform" AS ENUM ('WEB', 'MOBILE', 'API');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "planId" TEXT;

-- AlterTable
ALTER TABLE "verification_requests" ADD COLUMN     "platform" "ClientPlatform" NOT NULL DEFAULT 'WEB';

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "PlanCategory" NOT NULL,
    "allowancePerPeriod" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verificationRequestId" TEXT NOT NULL,
    "platform" "ClientPlatform" NOT NULL,
    "usagePeriodStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_verificationRequestId_key" ON "usage_records"("verificationRequestId");

-- CreateIndex
CREATE INDEX "usage_records_organizationId_usagePeriodStart_idx" ON "usage_records"("organizationId", "usagePeriodStart");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_verificationRequestId_fkey" FOREIGN KEY ("verificationRequestId") REFERENCES "verification_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
