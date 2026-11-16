CREATE TABLE "StoredFile" (
    "key" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "modified" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "StoredFile_modified_idx" ON "StoredFile"("modified");
