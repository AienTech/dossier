import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { POSTGRES_SCHEMA, SQLITE_SCHEMA, sqliteSchema } from "./sqlite-schema";

describe("the SQLite schema", () => {
  it("is up to date with prisma/schema.prisma (run `yarn sqlite-schema` if not)", () => {
    expect(readFileSync(SQLITE_SCHEMA, "utf8")).toBe(sqliteSchema(readFileSync(POSTGRES_SCHEMA, "utf8")));
  });

  it("refuses a native type it doesn't know how to translate", () => {
    const schema = 'provider = "postgresql"\noutput   = "../src/generated/prisma"\n  price Decimal @db.Money\n';
    expect(() => sqliteSchema(schema)).toThrow("@db.Money has no SQLite equivalent");
  });
});
