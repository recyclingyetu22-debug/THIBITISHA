/*
  Warnings:

  - The primary key for the `document_number_counters` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `organizationId` on the `document_number_counters` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "document_number_counters" DROP CONSTRAINT "document_number_counters_pkey",
DROP COLUMN "organizationId",
ADD CONSTRAINT "document_number_counters_pkey" PRIMARY KEY ("year");
