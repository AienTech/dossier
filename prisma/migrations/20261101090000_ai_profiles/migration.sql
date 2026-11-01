-- CreateTable
CREATE TABLE "AiProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "provider" "AiProvider" NOT NULL,
    "baseUrl" TEXT,
    "model" TEXT,
    "apiKeyEnc" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProfile_pkey" PRIMARY KEY ("id")
);

-- The saved provider becomes the first profile and the default.
INSERT INTO "AiProfile" ("id", "name", "provider", "baseUrl", "model", "apiKeyEnc", "updatedAt")
SELECT 'ai-profile-default',
       '',
       p."value"::"AiProvider",
       (SELECT "value" FROM "Setting" WHERE "key" = 'baseUrl'),
       (SELECT "value" FROM "Setting" WHERE "key" = 'model'),
       (SELECT "value" FROM "Setting" WHERE "key" = 'apiKeyEnc'),
       CURRENT_TIMESTAMP
FROM "Setting" p
WHERE p."key" = 'provider' AND p."value" IN ('LOCAL', 'OPENAI', 'ANTHROPIC', 'MISTRAL', 'LMSTUDIO');

INSERT INTO "Setting" ("key", "value", "updatedAt")
SELECT 'aiDefaultProfileId', 'ai-profile-default', CURRENT_TIMESTAMP
FROM "AiProfile" WHERE "id" = 'ai-profile-default';

DELETE FROM "Setting" WHERE "key" IN ('provider', 'baseUrl', 'model', 'apiKeyEnc');
