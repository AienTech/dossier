ALTER TABLE "Application" ADD COLUMN "submission" JSONB;
CREATE TABLE "ConnectorGrant" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "generation" TEXT NOT NULL, "permissions" JSONB NOT NULL, "requested" JSONB NOT NULL, "approvedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "ConnectorApproval" ("id" TEXT NOT NULL PRIMARY KEY, "clientId" TEXT NOT NULL, "action" TEXT NOT NULL, "payload" JSONB NOT NULL, "digest" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "expiresAt" TIMESTAMP(3) NOT NULL, "result" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "ConnectorApproval_clientId_createdAt_idx" ON "ConnectorApproval"("clientId", "createdAt");
CREATE TABLE "ConnectorAudit" ("id" TEXT NOT NULL PRIMARY KEY, "clientId" TEXT NOT NULL, "action" TEXT NOT NULL, "target" TEXT, "outcome" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "ConnectorAudit_clientId_createdAt_idx" ON "ConnectorAudit"("clientId", "createdAt");
