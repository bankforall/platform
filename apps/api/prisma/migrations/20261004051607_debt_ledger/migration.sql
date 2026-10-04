-- CreateTable
CREATE TABLE "Debt" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "debtor" TEXT NOT NULL,
    "creditor" TEXT NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Debt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Debt_debtor_idx" ON "Debt"("debtor");

-- CreateIndex
CREATE UNIQUE INDEX "Debt_circleId_debtor_creditor_key" ON "Debt"("circleId", "debtor", "creditor");
