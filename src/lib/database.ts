import { AsyncLocalStorage } from "node:async_hooks";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { PrismaClient as SqlitePrismaClient } from "@/generated/prisma-sqlite/client";

// PostgreSQL or SQLite (#17), chosen by DATABASE_URL: postgresql://… or
// file:/absolute/path.db. Both clients come from the same models, so the app
// types everything with the PostgreSQL one.

/** Whether a DATABASE_URL points at SQLite. */
export const isSqliteUrl = (url: string) => url.startsWith("file:");

/** Whether this process uses SQLite. */
export const usesSqlite = () => isSqliteUrl(process.env.DATABASE_URL ?? "");

/** A client for the database at `url`. */
export function createPrismaClient(url: string): PrismaClient {
  return isSqliteUrl(url) ? createSqliteClient(url) : new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/**
 * `FOR UPDATE`, to lock the rows a `$queryRaw` reads until the transaction
 * ends. SQLite has no row locks and needs none: its transactions run one at
 * a time.
 */
export const forUpdate = () => (usesSqlite() ? Prisma.empty : Prisma.sql`FOR UPDATE`);

type SqliteAdapter = Awaited<ReturnType<PrismaBetterSqlite3["connect"]>>;

/** A first-come, first-served lock; `acquire` resolves to its release. */
function createLock() {
  let tail = Promise.resolve();
  return {
    acquire(): Promise<() => void> {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      const acquired = tail.then(() => release);
      tail = tail.then(() => released);
      return acquired;
    },
  };
}

/**
 * The SQLite client. better-sqlite3 has one connection, so a query made
 * while another request's transaction is open would run inside it, and be
 * undone with it. Here such queries wait until the transaction ends; queries
 * from inside a `$transaction` callback still run at once, as before.
 */
function createSqliteClient(url: string): PrismaClient {
  const lock = createLock();
  const inTransaction = new AsyncLocalStorage<boolean>();
  const serialized = async <T>(run: () => Promise<T>): Promise<T> => {
    if (inTransaction.getStore()) return run();
    const release = await lock.acquire();
    try {
      return await run();
    } finally {
      release();
    }
  };

  const factory = new PrismaBetterSqlite3({ url });
  const connect = factory.connect.bind(factory);
  factory.connect = async () => {
    const adapter = await connect();
    return Object.assign(Object.create(adapter) as SqliteAdapter, {
      queryRaw: (query: Parameters<SqliteAdapter["queryRaw"]>[0]) => serialized(() => adapter.queryRaw(query)),
      executeRaw: (query: Parameters<SqliteAdapter["executeRaw"]>[0]) => serialized(() => adapter.executeRaw(query)),
      executeScript: (script: string) => serialized(() => adapter.executeScript(script)),
      async startTransaction(isolationLevel?: Parameters<SqliteAdapter["startTransaction"]>[0]) {
        const release = await lock.acquire();
        try {
          const transaction = await adapter.startTransaction(isolationLevel);
          const end = (finish: () => Promise<void>) => () => finish().finally(release);
          return Object.assign(transaction, {
            commit: end(transaction.commit.bind(transaction)),
            rollback: end(transaction.rollback.bind(transaction)),
          });
        } catch (error) {
          release();
          throw error;
        }
      },
    });
  };

  const client = new SqlitePrismaClient({ adapter: factory });
  return new Proxy(client, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "$transaction") {
        return (input: unknown, options?: unknown) =>
          typeof input === "function"
            ? value.call(target, (tx: unknown) => inTransaction.run(true, () => input(tx)), options)
            : value.call(target, input, options);
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as PrismaClient;
}
