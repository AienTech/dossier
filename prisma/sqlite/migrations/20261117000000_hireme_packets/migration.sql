-- AlterTable
ALTER TABLE "Application" ADD COLUMN "driveSync" JSONB;
ALTER TABLE "Application" ADD COLUMN "submission" JSONB;

-- CreateTable
CREATE TABLE "StoredFile" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "data" BLOB NOT NULL,
    "modified" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ConnectorGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "generation" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "requested" JSONB NOT NULL,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ConnectorApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "digest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" DATETIME NOT NULL,
    "result" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ConnectorAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "StoredFile_modified_idx" ON "StoredFile"("modified");

-- CreateIndex
CREATE INDEX "ConnectorApproval_clientId_createdAt_idx" ON "ConnectorApproval"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ConnectorAudit_clientId_createdAt_idx" ON "ConnectorAudit"("clientId", "createdAt");

