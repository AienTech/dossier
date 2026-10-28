// Writes prisma/sqlite/schema.prisma, the SQLite copy of prisma/schema.prisma
// (#17). Run it after every change to the schema:
//
//   docker/bin/yarn sqlite-schema

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const POSTGRES_SCHEMA = fileURLToPath(new URL("schema.prisma", import.meta.url));
export const SQLITE_SCHEMA = fileURLToPath(new URL("sqlite/schema.prisma", import.meta.url));

const HEADER = `// Generated from prisma/schema.prisma by prisma/sqlite-schema.ts: don't edit,
// run \`docker/bin/yarn sqlite-schema\` instead.

`;

// Native types SQLite doesn't have. Citext's case-insensitive uniqueness is
// kept with COLLATE NOCASE in the SQLite migrations.
const DROPPED_TYPES = ["@db.Citext", "@db.Date"];

function replaceOnce(source: string, from: string, to: string): string {
  if (source.split(from).length !== 2) throw new Error(`Expected exactly one ${from} in prisma/schema.prisma.`);
  return source.replace(from, to);
}

/** The SQLite version of the PostgreSQL schema. */
export function sqliteSchema(postgres: string): string {
  let schema = replaceOnce(postgres, 'provider = "postgresql"', 'provider = "sqlite"');
  schema = replaceOnce(schema, 'output   = "../src/generated/prisma"', 'output   = "../../src/generated/prisma-sqlite"');
  for (const type of DROPPED_TYPES) schema = schema.replaceAll(` ${type}`, "");
  const unknown = schema.match(/@db\.\w+/);
  if (unknown) throw new Error(`${unknown[0]} has no SQLite equivalent yet: handle it in prisma/sqlite-schema.ts.`);
  return HEADER + schema;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(SQLITE_SCHEMA, sqliteSchema(readFileSync(POSTGRES_SCHEMA, "utf8")));
  console.log("Wrote prisma/sqlite/schema.prisma.");
}
