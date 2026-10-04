-- CreateTable
CREATE TABLE "AdminPasskey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "AdminPasskey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminPasskey_credentialId_key" ON "AdminPasskey"("credentialId");

-- CreateIndex
CREATE INDEX "AdminPasskey_userId_idx" ON "AdminPasskey"("userId");

-- AddForeignKey
ALTER TABLE "AdminPasskey" ADD CONSTRAINT "AdminPasskey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
