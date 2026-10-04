-- AlterTable
ALTER TABLE "Circle" ADD COLUMN     "maxBid" BIGINT,
ADD COLUMN     "openUntil" TIMESTAMP(3),
ADD COLUMN     "trustedReputation" INTEGER;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "offset" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "wasDefaulted" BOOLEAN NOT NULL DEFAULT false;
