import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

import { deleteStoredFile, deleteStoredFiles, listStoredFiles, readStoredFile, storeFile } from "./stored-files";

beforeEach(() => resetDatabase(db.client!));
afterAll(() => db.client!.$disconnect());

describe("private cloud artifacts", () => {
  it("keeps bytes across reads and replaces an existing file without duplicating it", async () => {
    const data = new Uint8Array([0, 255, 37, 80, 68, 70]);
    await storeFile("downloads", "packet.zip", data);
    expect(await readStoredFile("downloads", "packet.zip")).toEqual(data);
    await storeFile("downloads", "packet.zip", new Uint8Array([42]));
    expect(await readStoredFile("downloads", "packet.zip")).toEqual(new Uint8Array([42]));
    expect(await listStoredFiles("downloads")).toHaveLength(1);
  });

  it("prunes expired downloads without deleting backups or newer downloads", async () => {
    const old = new Date("2026-11-01T00:00:00Z");
    const recent = new Date("2026-11-12T00:00:00Z");
    const data = new Uint8Array([1]);
    await storeFile("downloads", "old.zip", data, old);
    await storeFile("downloads", "new.zip", data, recent);
    await storeFile("backups", "backup.json", data, old);
    await deleteStoredFiles("downloads", recent);
    expect(await readStoredFile("downloads", "old.zip")).toBeNull();
    expect(await readStoredFile("downloads", "new.zip")).toEqual(data);
    expect(await readStoredFile("backups", "backup.json")).toEqual(data);
    await deleteStoredFile("backups", "backup.json");
    expect(await listStoredFiles("backups")).toEqual([]);
  });

  it("refuses traversal instead of crossing artifact namespaces", async () => {
    await expect(readStoredFile("downloads", "../backups/private.json")).rejects.toThrow(/Invalid file name/);
  });
});
