-- DropForeignKey
ALTER TABLE "AiAttempt" DROP CONSTRAINT "AiAttempt_jobId_fkey";

-- DropForeignKey
ALTER TABLE "AiAttempt" DROP CONSTRAINT "AiAttempt_tripId_fkey";

-- AlterTable
ALTER TABLE "AiAttempt" ALTER COLUMN "jobId" DROP NOT NULL,
ALTER COLUMN "tripId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "AiAttempt" ADD CONSTRAINT "AiAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAttempt" ADD CONSTRAINT "AiAttempt_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
