-- AlterEnum
ALTER TYPE "PostingSource" ADD VALUE 'STARTUP';

-- AlterTable
ALTER TABLE "AgentCandidate" ADD COLUMN "startupId" TEXT;

-- AddForeignKey
ALTER TABLE "AgentCandidate" ADD CONSTRAINT "AgentCandidate_startupId_fkey" FOREIGN KEY ("startupId") REFERENCES "Startup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
