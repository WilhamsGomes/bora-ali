-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'PROVIDER_ACCEPTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiAttemptStatus" AS ENUM ('RESERVED', 'SUCCEEDED', 'REFUSED', 'TRUNCATED', 'INVALID_OUTPUT', 'TRANSIENT_ERROR', 'ERROR', 'ABANDONED');

-- CreateEnum
CREATE TYPE "AiCostStatus" AS ENUM ('RESERVED', 'ESTIMATED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryErrorCode" TEXT,
ADD COLUMN     "deliveryProvider" TEXT,
ADD COLUMN     "deliverySeq" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "deliveryStatus" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "lastDeliveryAttemptAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastSendRequestedAt" TIMESTAMPTZ(3),
ADD COLUMN     "providerAcceptedAt" TIMESTAMPTZ(3),
ADD COLUMN     "providerMessageId" TEXT,
ADD COLUMN     "tokenNonce" TEXT;

-- CreateTable
CREATE TABLE "AiAttempt" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "callIndex" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "requestedModel" TEXT NOT NULL,
    "model" TEXT,
    "status" "AiAttemptStatus" NOT NULL DEFAULT 'RESERVED',
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheCreationInputTokens" INTEGER,
    "cacheReadInputTokens" INTEGER,
    "durationMs" INTEGER,
    "reservedCostMicros" INTEGER NOT NULL,
    "costMicros" INTEGER,
    "costStatus" "AiCostStatus" NOT NULL DEFAULT 'RESERVED',
    "currency" TEXT NOT NULL,
    "pricingReferenceDate" TEXT NOT NULL,
    "errorCode" TEXT,
    "refusalCategory" TEXT,
    "providerRequestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AiAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAttempt_tripId_idx" ON "AiAttempt"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "AiAttempt_jobId_callIndex_attemptNumber_key" ON "AiAttempt"("jobId", "callIndex", "attemptNumber");

-- AddForeignKey
ALTER TABLE "AiAttempt" ADD CONSTRAINT "AiAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAttempt" ADD CONSTRAINT "AiAttempt_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
