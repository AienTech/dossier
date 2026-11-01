-- CreateTable
CREATE TABLE "AgentSearch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "query" JSONB NOT NULL,
    "sources" "PostingSource"[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCandidateSearch" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "searchId" TEXT,
    "searchName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCandidateSearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentSearch_sort_createdAt_idx" ON "AgentSearch"("sort", "createdAt");

-- CreateIndex
CREATE INDEX "AgentCandidateSearch_searchId_idx" ON "AgentCandidateSearch"("searchId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCandidateSearch_candidateId_searchId_key" ON "AgentCandidateSearch"("candidateId", "searchId");

-- AddForeignKey
ALTER TABLE "AgentCandidateSearch" ADD CONSTRAINT "AgentCandidateSearch_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "AgentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCandidateSearch" ADD CONSTRAINT "AgentCandidateSearch_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "AgentSearch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The agent's one search becomes the first saved search, when it has keywords.
DO $$
DECLARE
  saved JSONB;
BEGIN
  SELECT "value"::jsonb INTO saved FROM "Setting" WHERE "key" = 'agentQuery';
  IF saved IS NOT NULL AND jsonb_typeof(saved) = 'object' AND length(trim(coalesce(saved->>'keywords', ''))) > 0 THEN
    INSERT INTO "AgentSearch" ("id", "name", "query", "sources", "updatedAt")
    VALUES ('agent-search-legacy', '', saved, '{}', CURRENT_TIMESTAMP);
  END IF;
EXCEPTION WHEN invalid_text_representation THEN
  NULL;
END $$;

DELETE FROM "Setting" WHERE "key" = 'agentQuery';
