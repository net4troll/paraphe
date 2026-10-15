-- CreateEnum
CREATE TYPE "field_type" AS ENUM ('text', 'textarea', 'date', 'number', 'checkbox', 'select');

-- AlterTable
ALTER TABLE "signers" ALTER COLUMN "email" SET DEFAULT '';

-- CreateTable
CREATE TABLE "fields" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "field_type" NOT NULL DEFAULT 'text',
    "options" TEXT,
    "page" INTEGER NOT NULL,
    "xPct" DOUBLE PRECISION NOT NULL,
    "yPct" DOUBLE PRECISION NOT NULL,
    "widthPct" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fields_documentId_idx" ON "fields"("documentId");

-- CreateIndex
CREATE INDEX "fields_signerId_idx" ON "fields"("signerId");

-- AddForeignKey
ALTER TABLE "fields" ADD CONSTRAINT "fields_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fields" ADD CONSTRAINT "fields_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "signers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
