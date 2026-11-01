import { readFileSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

const client = createTestClient();
const prisma = () => client;

/** The migration's data statements; the table already exists in the test database. */
const moveSettings = readFileSync("prisma/migrations/20261101090000_ai_profiles/migration.sql", "utf8")
  .split("-- The saved provider becomes the first profile and the default.")[1]
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);
const migrate = async () => {
  for (const statement of moveSettings) await prisma().$executeRawUnsafe(statement);
};

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("the ai_profiles migration", () => {
  it("turns the saved provider into the default profile and drops its settings", async () => {
    await prisma().setting.createMany({
      data: [
        { key: "provider", value: "OPENAI" },
        { key: "baseUrl", value: "https://llm.example/v1" },
        { key: "model", value: "gpt-x" },
        { key: "apiKeyEnc", value: "v1.iv.ct" },
        { key: "strict", value: "false" },
      ],
    });
    await migrate();
    expect(await prisma().aiProfile.findMany()).toEqual([
      expect.objectContaining({ id: "ai-profile-default", provider: "OPENAI", baseUrl: "https://llm.example/v1", model: "gpt-x", apiKeyEnc: "v1.iv.ct" }),
    ]);
    const settings = await prisma().setting.findMany({ select: { key: true, value: true }, orderBy: { key: "asc" } });
    expect(settings).toEqual([
      { key: "aiDefaultProfileId", value: "ai-profile-default" },
      { key: "strict", value: "false" },
    ]);
  });

  it("makes no profile without a saved provider", async () => {
    await prisma().setting.create({ data: { key: "model", value: "orphan" } });
    await migrate();
    expect(await prisma().aiProfile.count()).toBe(0);
    expect(await prisma().setting.count()).toBe(0);
  });
});
