-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('PHONE_VERIFY', 'STEP_UP');

-- CreateEnum
CREATE TYPE "RotationStatus" AS ENUM ('PENDING', 'APPROVED', 'EXECUTED', 'CANCELLED', 'FAILED');

-- AlterTable
ALTER TABLE "OtpChallenge" ADD COLUMN     "purpose" "OtpPurpose" NOT NULL DEFAULT 'PHONE_VERIFY';

-- CreateTable
CREATE TABLE "KeyRotationRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oldAddress" TEXT NOT NULL,
    "newAddress" TEXT NOT NULL,
    "proof" TEXT NOT NULL,
    "status" "RotationStatus" NOT NULL DEFAULT 'PENDING',
    "approvals" JSONB NOT NULL DEFAULT '[]',
    "executeAfter" TIMESTAMP(3),
    "reason" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyRotationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestError" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeyRotationRequest_status_executeAfter_idx" ON "KeyRotationRequest"("status", "executeAfter");

-- CreateIndex
CREATE INDEX "KeyRotationRequest_userId_status_idx" ON "KeyRotationRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetId_createdAt_idx" ON "AdminAuditLog"("targetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IngestError_txHash_logIndex_key" ON "IngestError"("txHash", "logIndex");

-- AddForeignKey
ALTER TABLE "KeyRotationRequest" ADD CONSTRAINT "KeyRotationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
