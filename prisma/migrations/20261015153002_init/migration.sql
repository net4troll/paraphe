-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('draft', 'pending', 'completed');

-- CreateEnum
CREATE TYPE "signer_status" AS ENUM ('pending', 'signed');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "document_status" NOT NULL DEFAULT 'draft',
    "originalPath" TEXT NOT NULL,
    "currentPath" TEXT NOT NULL,
    "finalPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signers" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Partenaire',
    "token" TEXT NOT NULL,
    "status" "signer_status" NOT NULL DEFAULT 'pending',
    "page" INTEGER,
    "xPct" DOUBLE PRECISION,
    "yPct" DOUBLE PRECISION,
    "signedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signers_token_key" ON "signers"("token");

-- CreateIndex
CREATE INDEX "signers_documentId_idx" ON "signers"("documentId");

-- AddForeignKey
ALTER TABLE "signers" ADD CONSTRAINT "signers_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
