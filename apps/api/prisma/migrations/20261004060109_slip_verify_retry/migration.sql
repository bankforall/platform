-- AlterTable
ALTER TABLE "Slip" ADD COLUMN     "verifyAfter" TIMESTAMP(3),
ADD COLUMN     "verifyAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Slip_verify_verifyAfter_idx" ON "Slip"("verify", "verifyAfter");
