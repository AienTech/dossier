-- A JSearch key saved for RapidAPI moves to its own setting; jsearchKeyEnc keeps OpenWeb Ninja's.
INSERT INTO "Setting" ("key", "value", "updatedAt")
SELECT 'jsearchRapidapiKeyEnc', k."value", CURRENT_TIMESTAMP
FROM "Setting" k
WHERE k."key" = 'jsearchKeyEnc'
  AND EXISTS (SELECT 1 FROM "Setting" h WHERE h."key" = 'jsearchHost' AND h."value" = 'rapidapi');

DELETE FROM "Setting" k
WHERE k."key" = 'jsearchKeyEnc'
  AND EXISTS (SELECT 1 FROM "Setting" h WHERE h."key" = 'jsearchHost' AND h."value" = 'rapidapi');
