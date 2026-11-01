-- The chosen job source becomes a list of them; Off becomes an empty list.
INSERT INTO "Setting" ("key", "value", "updatedAt")
SELECT 'jobSources', CASE WHEN "value" = 'OFF' THEN '[]' ELSE '["' || "value" || '"]' END, CURRENT_TIMESTAMP
FROM "Setting"
WHERE "key" = 'jobSource' AND "value" IN ('OFF', 'JSEARCH', 'ADZUNA', 'ARBEITSAGENTUR', 'FREEHIRE');

DELETE FROM "Setting" WHERE "key" = 'jobSource';

-- A kept search can ask several sources: each one's next page, count and problem are in "results".
ALTER TABLE "PostingSearch" ADD COLUMN "sources" "PostingSource"[];
ALTER TABLE "PostingSearch" ADD COLUMN "results" JSONB NOT NULL DEFAULT '[]';

UPDATE "PostingSearch"
SET "sources" = ARRAY["source"],
    "results" = jsonb_build_array(jsonb_build_object('source', "source"::text, 'found', "found", 'next', "next", 'problem', NULL));

ALTER TABLE "PostingSearch" DROP COLUMN "source";
ALTER TABLE "PostingSearch" DROP COLUMN "next";
