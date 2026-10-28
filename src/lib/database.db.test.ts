import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

const db = createTestClient();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("the database client", () => {
  it("keeps a write made during another request's transaction when that one is undone", async () => {
    let opened!: () => void;
    let undo!: () => void;
    const isOpen = new Promise<void>((resolve) => (opened = resolve));
    const transaction = db
      .$transaction(async (tx) => {
        await tx.setting.create({ data: { key: "inside", value: "1" } });
        opened();
        await new Promise<void>((resolve) => (undo = resolve));
        throw new Error("undone");
      })
      .catch(() => "undone");
    await isOpen;

    // Prisma's queries only start when awaited: give this one time to run.
    const outside = Promise.resolve(db.setting.create({ data: { key: "outside", value: "2" } }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    undo();

    expect(await transaction).toBe("undone");
    await outside;
    expect(await db.setting.findMany({ select: { key: true } })).toEqual([{ key: "outside" }]);
  });

  it("doesn't make a transaction's own callback wait for the transaction to end", async () => {
    const count = await db.$transaction(async (tx) => {
      await tx.setting.create({ data: { key: "inside", value: "1" } });
      return db.setting.count();
    });
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
