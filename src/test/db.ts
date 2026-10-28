import path from "node:path";

import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient, isSqliteUrl } from "@/lib/database";

const refuse = (name: string) =>
  new Error(`Refusing to run database tests against "${name}": its name must end in "_test".`);

/**
 * The database for `*.db.test.ts` files: TEST_DATABASE_URL, or DATABASE_URL
 * with "_test" added to the database name (for SQLite, the file name).
 * Refuses any database whose name doesn't end in "_test", so tests can never
 * wipe development data.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!explicit && !base) {
    throw new Error("Database tests need DATABASE_URL or TEST_DATABASE_URL.");
  }
  if (isSqliteUrl(explicit ?? base!)) {
    const file = path.parse((explicit ?? base!).slice("file:".length));
    const name = explicit ? file.name : `${file.name}_test`;
    if (!name.endsWith("_test")) throw refuse(file.base);
    return `file:${path.join(file.dir, name + file.ext)}`;
  }
  const url = new URL(explicit ?? base!);
  if (!explicit) url.pathname = `${url.pathname}_test`;
  if (!url.pathname.endsWith("_test")) throw refuse(url.pathname.slice(1));
  return url.toString();
}

export function createTestClient(): PrismaClient {
  return createPrismaClient(testDatabaseUrl());
}

/** Empties every table, so each test starts from a blank database. */
export async function resetDatabase(db: PrismaClient): Promise<void> {
  if (isSqliteUrl(testDatabaseUrl())) {
    const tables = await db.$queryRaw<{ name: string }[]>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'`;
    await db.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    // Lets the trigger that keeps built-in themes allow their delete.
    await db.$executeRawUnsafe(`UPDATE "Theme" SET "builtIn" = false`);
    for (const { name } of tables) await db.$executeRawUnsafe(`DELETE FROM "${name}"`);
    await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    return;
  }
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const names = tables.map(({ tablename }) => `"${tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}
