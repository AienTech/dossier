import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, resetDatabase } from "@/test/db";
import { settingsFromRows } from "@/lib/settings";
import { ensureDriveSync, parseDriveSync, readDriveSync, runDriveSync } from "./drive-sync";
import { archiveApplicationToDrive } from "./drive";
import { dispatchJob } from "@/lib/jobs/runner";
import { GoogleError } from "./errors";
const shared = vi.hoisted(() => ({ db: undefined as ReturnType<typeof createTestClient> | undefined, text: "Version one" }));
vi.mock("@/lib/prisma", async () => { const { createTestClient } = await import("@/test/db"); shared.db = createTestClient(); return { prisma: shared.db }; });
vi.mock("@/lib/env", () => ({ env: { HIREME_SECRET: "x".repeat(40) } }));
vi.mock("./account", () => ({
  googleConnection: async () => ({ status: "connected", email: "owner@example.com", canArchiveDrive: true }),
  loadGoogleAccount: async () => ({ email: "owner@example.com" }), accessToken: async () => "private-access",
}));
vi.mock("@/lib/jobs/runner", () => ({ defineJob: <T>(definition: T) => definition, dispatchJob: vi.fn(async () => {}) }));
vi.mock("./drive", () => ({ archiveApplicationToDrive: vi.fn() }));
vi.mock("@/lib/application-documents", () => ({ loadDocuments: async (id: string) => {
  const application = await shared.db!.application.findUniqueOrThrow({ where: { id } });
  return { application, profile: { basics: { name: "Jane" } }, resume: { units: [{ text: shared.text }], theme: {} }, letter: null,
    settings: settingsFromRows(await shared.db!.setting.findMany()), includeReferences: false, letterDate: "2026-11-14" };
} }));
const db = () => shared.db!;
beforeEach(async () => {
  await resetDatabase(db()); vi.clearAllMocks(); shared.text = "Version one";
  await db().application.create({ data: { id: "app-one", role: "Engineer" } });
  vi.mocked(archiveApplicationToDrive).mockImplementation(async (_id, verify) => { await verify?.(); return { url: "https://drive.google.com/drive/folders/snapshot", files: ["resume.pdf"] }; });
});
afterAll(() => db().$disconnect());
const row = () => db().application.findUniqueOrThrow({ where: { id: "app-one" } });

describe("durable Drive auto-sync", () => {
  it("coalesces simultaneous requests, saves one snapshot and ignores unchanged content and archive notes", async () => {
    const before = (await row()).updatedAt;
    await Promise.all([ensureDriveSync("app-one"), ensureDriveSync("app-one"), ensureDriveSync("app-one")]);
    expect(await db().job.count()).toBe(1); expect(dispatchJob).toHaveBeenCalledTimes(1);
    const state = parseDriveSync((await row()).driveSync);
    await runDriveSync("app-one", "owner@example.com", state.jobId!);
    expect((await readDriveSync("app-one")).status).toBe("ready");
    await runDriveSync("app-one", "owner@example.com", state.jobId!);
    await ensureDriveSync("app-one");
    expect(await db().job.count()).toBe(1); expect(archiveApplicationToDrive).toHaveBeenCalledTimes(1);
    expect(await db().note.count()).toBe(0); expect((await row()).updatedAt).toEqual(before);
    shared.text = "Version two";
    await ensureDriveSync("app-one"); expect(await db().job.count()).toBe(2);
  });
  it("retains an actionable failure and does not retry continuously until explicitly requested", async () => {
    await ensureDriveSync("app-one"); const state = parseDriveSync((await row()).driveSync);
    vi.mocked(archiveApplicationToDrive).mockRejectedValueOnce(new GoogleError("revoked", "Reconnect Google Drive."));
    await expect(runDriveSync("app-one", "owner@example.com", state.jobId!)).rejects.toThrow("Reconnect");
    expect(await readDriveSync("app-one")).toMatchObject({ status: "error", error: "Reconnect Google Drive." });
    await ensureDriveSync("app-one"); expect(await db().job.count()).toBe(1); expect(await db().note.count()).toBe(0);
    await ensureDriveSync("app-one", true); expect(await db().job.count()).toBe(2);
    expect(await db().setting.findUnique({ where: { key: "driveSyncProblem" } })).toMatchObject({ value: "Reconnect Google Drive." });
  });
  it("does not publish a packet when documents change during PDF generation", async () => {
    await ensureDriveSync("app-one"); const state = parseDriveSync((await row()).driveSync);
    vi.mocked(archiveApplicationToDrive).mockImplementationOnce(async (_id, verify) => { shared.text = "Changed while printing"; await verify?.(); throw new Error("Should not upload stale content"); });
    expect(await runDriveSync("app-one", "owner@example.com", state.jobId!)).toEqual({ url: "", sourceHash: "" });
    expect(await db().note.count()).toBe(0); expect((await readDriveSync("app-one")).status).toBe("idle");
    await ensureDriveSync("app-one"); expect(await db().job.count()).toBe(2);
  });
  it("queues a fresh snapshot when the shared template or bot preferences change", async () => {
    await ensureDriveSync("app-one"); const first = parseDriveSync((await row()).driveSync);
    await runDriveSync("app-one", "owner@example.com", first.jobId!);
    await db().job.update({ where: { id: first.jobId! }, data: { status: "DONE" } });
    await db().setting.create({ data: { key: "applyBotPromptTemplate", value: "Custom {{role}} prompt" } });
    await ensureDriveSync("app-one");
    expect(await db().job.count()).toBe(2);
    const second = parseDriveSync((await row()).driveSync);
    await runDriveSync("app-one", "owner@example.com", second.jobId!);
    await db().job.update({ where: { id: second.jobId! }, data: { status: "DONE" } });
    await db().setting.create({ data: { key: "applyBotOpenbotNotes", value: "A new review format" } });
    await ensureDriveSync("app-one");
    expect(await db().job.count()).toBe(3);
  });
  it("does not queue uploads when the owner disables auto-save", async () => {
    await db().setting.create({ data: { key: "driveAutoSave", value: "false" } });
    expect(await ensureDriveSync("app-one")).toEqual({ status: "disabled" }); expect(await db().job.count()).toBe(0);
  });
});
