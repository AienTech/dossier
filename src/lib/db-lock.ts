import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { usesSqlite } from "@/lib/database";

/**
 * Makes transactions that take the same key wait for each other (public PR
 * 61's job agent locks): a transaction-scoped advisory lock on PostgreSQL. On
 * SQLite there's nothing to take, since Prisma's adapter runs one
 * transaction at a time on its one connection (DEVELOPMENT.md, SQLite).
 */
export async function lockForTransaction(tx: Prisma.TransactionClient, key: number): Promise<void> {
  if (usesSqlite()) return;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key}::bigint)::text`;
}

/**
 * A stable key for `lockForTransaction`, from a name such as "inbox-check".
 * The range starts at 1e9 so it cannot meet the few fixed lock ids the app
 * uses, and stays below 2^31 so it is exact in a JavaScript number.
 */
export function lockKeyFor(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 1_000_000_000 + ((hash >>> 0) % 1_000_000_000);
}
