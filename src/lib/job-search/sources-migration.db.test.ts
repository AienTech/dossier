import { readFileSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

const client = createTestClient();
const prisma = () => client;

/** A migration's statements, run again on the migrated test database. */
const dataStatements = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8");
const run = async (sql: string) => {
  const code = sql.replace(/^--.*$/gm, "");
  for (const statement of code.split(";").map((part) => part.trim()).filter(Boolean)) await prisma().$executeRawUnsafe(statement);
};
const settings = async () => Object.fromEntries((await prisma().setting.findMany()).map((row) => [row.key, row.value]));

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("the jsearch_keys migration", () => {
  const migrate = () => run(dataStatements("20261101090100_jsearch_keys"));

  it("moves a key saved for RapidAPI to its own setting", async () => {
    await prisma().setting.createMany({ data: [{ key: "jsearchKeyEnc", value: "v1.a.b" }, { key: "jsearchHost", value: "rapidapi" }] });
    await migrate();
    expect(await settings()).toEqual({ jsearchHost: "rapidapi", jsearchRapidapiKeyEnc: "v1.a.b" });
  });

  it("leaves OpenWeb Ninja's key where it is", async () => {
    await prisma().setting.create({ data: { key: "jsearchKeyEnc", value: "v1.a.b" } });
    await migrate();
    expect(await settings()).toEqual({ jsearchKeyEnc: "v1.a.b" });
  });
});
