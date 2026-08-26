-- AlterTable
ALTER TABLE "verification_findings" ADD COLUMN     "regions" JSONB;

-- AlterTable
ALTER TABLE "verification_requests" ADD COLUMN     "moduleCoverage" JSONB;
