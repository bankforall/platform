-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CircleStatus" AS ENUM ('DRAFT', 'OPEN', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NONE', 'DECLARED', 'ATTESTED', 'CONFIRMED', 'DEFAULTED');

-- CreateEnum
CREATE TYPE "SlipVerify" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('PREPARED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT,
    "displayName" TEXT NOT NULL,
    "pictureUrl" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "phone" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "promptPayId" TEXT,
    "consentVersion" TEXT,
    "consentAt" TIMESTAMP(3),
    "walletAddress" TEXT,
    "walletBackup" JSONB,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NONE',
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "reputationBase" INTEGER NOT NULL DEFAULT 100,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullNameEnc" TEXT NOT NULL,
    "nationalIdHash" TEXT NOT NULL,
    "nationalIdLast4" TEXT NOT NULL,
    "idCardKey" TEXT NOT NULL,
    "selfieKey" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "reviewerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "KycSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Circle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "hostId" TEXT NOT NULL,
    "hostAddress" TEXT NOT NULL,
    "type" INTEGER NOT NULL,
    "principal" BIGINT NOT NULL,
    "maxMembers" INTEGER NOT NULL,
    "hostTakesFirst" BOOLEAN NOT NULL,
    "fixRateBps" INTEGER NOT NULL,
    "minReputation" INTEGER NOT NULL,
    "period" INTEGER NOT NULL,
    "bidWindow" INTEGER NOT NULL,
    "revealWindow" INTEGER NOT NULL,
    "paymentWindow" INTEGER NOT NULL,
    "grace" INTEGER NOT NULL,
    "isPrivate" BOOLEAN NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "status" "CircleStatus" NOT NULL DEFAULT 'DRAFT',
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "createdTx" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Circle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "userId" TEXT,
    "address" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "seat" INTEGER NOT NULL,
    "reputation" INTEGER NOT NULL,
    "hasWon" BOOLEAN NOT NULL DEFAULT false,
    "wonRound" INTEGER,
    "wonBid" BIGINT NOT NULL DEFAULT 0,
    "defaulted" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Round" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "bidding" BOOLEAN NOT NULL,
    "biddingEnds" TIMESTAMP(3),
    "revealEnds" TIMESTAMP(3),
    "decided" BOOLEAN NOT NULL DEFAULT false,
    "recipient" TEXT,
    "winningBid" BIGINT NOT NULL DEFAULT 0,
    "paymentDeadline" TIMESTAMP(3),

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "payer" TEXT NOT NULL,
    "amount" BIGINT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'NONE',
    "slipHash" TEXT,
    "slipId" TEXT,
    "txHash" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slip" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "payer" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "verify" "SlipVerify" NOT NULL DEFAULT 'PENDING',
    "verifyDetail" JSONB,
    "attestTx" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Slip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidSecret" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "member" TEXT NOT NULL,
    "amountEnc" TEXT NOT NULL,
    "saltEnc" TEXT NOT NULL,
    "committed" BOOLEAN NOT NULL DEFAULT false,
    "revealed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TxIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "circleId" TEXT,
    "kind" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "gas" BIGINT NOT NULL,
    "nonce" BIGINT NOT NULL,
    "deadline" INTEGER NOT NULL,
    "meta" JSONB,
    "status" "IntentStatus" NOT NULL DEFAULT 'PREPARED',
    "txHash" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TxIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainEvent" (
    "id" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTime" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainCursor" (
    "id" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,

    CONSTRAINT "ChainCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "circleId" TEXT,
    "readAt" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reasonHash" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_lineUserId_key" ON "User"("lineUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "KycSubmission_status_createdAt_idx" ON "KycSubmission"("status", "createdAt");

-- CreateIndex
CREATE INDEX "KycSubmission_nationalIdHash_idx" ON "KycSubmission"("nationalIdHash");

-- CreateIndex
CREATE INDEX "OtpChallenge_userId_createdAt_idx" ON "OtpChallenge"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Circle_address_key" ON "Circle"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Circle_inviteCode_key" ON "Circle"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "Circle_createdTx_key" ON "Circle"("createdTx");

-- CreateIndex
CREATE INDEX "Circle_status_isPrivate_idx" ON "Circle"("status", "isPrivate");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_circleId_address_key" ON "Membership"("circleId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_circleId_index_key" ON "Membership"("circleId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "Round_circleId_number_key" ON "Round"("circleId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_circleId_round_payer_key" ON "Payment"("circleId", "round", "payer");

-- CreateIndex
CREATE INDEX "Slip_circleId_round_idx" ON "Slip"("circleId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "BidSecret_circleId_round_member_key" ON "BidSecret"("circleId", "round", "member");

-- CreateIndex
CREATE INDEX "TxIntent_userId_createdAt_idx" ON "TxIntent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ChainEvent_address_blockNumber_idx" ON "ChainEvent"("address", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ChainEvent_txHash_logIndex_key" ON "ChainEvent"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "KycSubmission" ADD CONSTRAINT "KycSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Circle" ADD CONSTRAINT "Circle_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slip" ADD CONSTRAINT "Slip_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slip" ADD CONSTRAINT "Slip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidSecret" ADD CONSTRAINT "BidSecret_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TxIntent" ADD CONSTRAINT "TxIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TxIntent" ADD CONSTRAINT "TxIntent_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
