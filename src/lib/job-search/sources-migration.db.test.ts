import { readFileSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

const client = createTestClient();
const prisma = () => client;

/** A migration's statements that move data, run again on the migrated test database. */
const dataStatements = (name: string, from?: string, to?: string) => {
  let sql = readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8");
  if (from) sql = sql.split(from)[1];
  if (to) sql = sql.split(to)[0];
  return sql;
};
const run = async (sql: string, { block = false } = {}) => {
  if (block) return void (await prisma().$executeRawUnsafe(sql));
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

describe("the job_sources migration", () => {
  const migrate = () => run(dataStatements("20261101090200_job_sources", undefined, "-- A kept search can ask several sources"));

  it("turns the chosen source into a list, and Off into an empty one", async () => {
    await prisma().setting.create({ data: { key: "jobSource", value: "ADZUNA" } });
    await migrate();
    expect(await settings()).toEqual({ jobSources: '["ADZUNA"]' });
    await prisma().setting.deleteMany();
    await prisma().setting.create({ data: { key: "jobSource", value: "OFF" } });
    await migrate();
    expect(await settings()).toEqual({ jobSources: "[]" });
  });
});

describe("the agent_searches migration", () => {
  const migrate = () => run(dataStatements("20261101090300_agent_searches", "-- The agent's one search becomes the first saved search, when it has keywords.", "DELETE FROM"), { block: true });
  const drop = () => run(`DELETE FROM "Setting" WHERE "key" = 'agentQuery'`);

  it("makes the agent's search the first saved one, and drops the setting", async () => {
    const query = { keywords: "Data scientist", place: "Berlin", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" };
    await prisma().setting.create({ data: { key: "agentQuery", value: JSON.stringify(query) } });
    await migrate();
    await drop();
    expect(await prisma().agentSearch.findMany()).toEqual([expect.objectContaining({ id: "agent-search-legacy", query, sources: [], enabled: true })]);
    expect(await settings()).toEqual({});
  });

  it("makes none from a search without keywords, or one that isn't JSON", async () => {
    await prisma().setting.create({ data: { key: "agentQuery", value: JSON.stringify({ keywords: "  ", country: "de" }) } });
    await migrate();
    await prisma().setting.update({ where: { key: "agentQuery" }, data: { value: "{not json" } });
    await migrate();
    expect(await prisma().agentSearch.count()).toBe(0);
  });
});
