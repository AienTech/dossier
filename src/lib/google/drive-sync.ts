import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { loadDocuments } from "@/lib/application-documents";
import { lockForTransaction, lockKeyFor } from "@/lib/db-lock";
import { prisma } from "@/lib/prisma";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { accessToken, googleConnection, loadGoogleAccount } from "./account";
import { archiveApplicationToDrive } from "./drive";
import { GoogleError } from "./errors";

export const driveSyncSchema = z.object({
  sourceHash: z.string().optional(), attemptedHash: z.string().optional(), account: z.string().optional(),
  url: z.string().optional(), syncedAt: z.string().optional(), error: z.string().nullable().optional(), jobId: z.string().nullable().optional(),
});
export type DriveSyncState = z.infer<typeof driveSyncSchema>;
export type DriveSyncView = { status: "idle" | "syncing" | "ready" | "error" | "disabled"; url?: string; error?: string; sourceHash?: string };
export const parseDriveSync = (value: unknown): DriveSyncState => driveSyncSchema.safeParse(value).data ?? {};

/** Excludes notes, job state and timestamps: saving an archive cannot schedule itself again. */
export function driveSourceHash(
  data: Pick<Awaited<ReturnType<typeof loadDocuments>>, "application" | "profile" | "settings" | "resume" | "letter" | "includeReferences" | "letterDate">,
): string {
  const a = data.application;
  return createHash("sha256").update(JSON.stringify({
    version: 3, promptTemplate: data.settings.applyBotPromptTemplate, botNotes: [data.settings.applyBotClaudeNotes, data.settings.applyBotGrokNotes, data.settings.applyBotOpenbotNotes, data.settings.applyBotOtherNotes], status: a.status, id: a.id, company: a.company, title: a.title, role: a.role, location: a.location, salary: a.salary,
    postingUrl: a.postingUrl, postingText: a.postingText, match: a.match, followThemeLayout: a.followThemeLayout,
    showPhoto: a.showPhoto, profile: data.profile, resume: data.resume, letter: data.letter,
    references: data.includeReferences, letterDate: data.letterDate,
    paper: data.settings.paper, dateFormat: data.settings.dateFormat,
  })).digest("hex");
}

async function source(id: string) {
  const data = await loadDocuments(id);
  return { hash: driveSourceHash(data), eligible: !data.application.awaitingReview && Boolean(data.resume || data.letter), state: parseDriveSync(data.application.driveSync) };
}

export async function readDriveSync(id: string): Promise<DriveSyncView> {
  const row = await prisma.application.findUnique({ where: { id }, select: { driveSync: true } });
  const state = parseDriveSync(row?.driveSync);
  if (state.jobId) {
    const job = await prisma.job.findUnique({ where: { id: state.jobId }, select: { status: true, error: true } });
    if (job && (job.status === "QUEUED" || job.status === "RUNNING")) return { status: "syncing" };
    if (job?.status === "FAILED") return { status: "error", error: state.error || job.error || "Drive auto-save failed. Retry after checking Google settings." };
  }
  if (state.error) return { status: "error", error: state.error };
  return state.url ? { status: "ready", url: state.url, sourceHash: state.sourceHash } : { status: "idle" };
}

/** Transactional queue producer: one in-flight sync per job, unchanged files are never uploaded twice. */
export async function ensureDriveSync(id: string, retry = false): Promise<DriveSyncView> {
  const settings = await loadSettings();
  if (!settings.driveAutoSave) return { status: "disabled" };
  const connection = await googleConnection();
  if (connection.status !== "connected" || !connection.canArchiveDrive) return { status: "disabled" };
  const current = await source(id);
  if (!current.eligible) return { status: "disabled" };
  const { driveArchiveJob } = await import("@/lib/jobs/drive-archive");
  const queued = await prisma.$transaction(async tx => {
    await lockForTransaction(tx, lockKeyFor(`drive-sync:${id}`));
    const row = await tx.application.findUnique({ where: { id }, select: { driveSync: true, updatedAt: true } });
    if (!row) return null;
    const state = parseDriveSync(row.driveSync);
    if (state.jobId) {
      const pending = await tx.job.findUnique({ where: { id: state.jobId }, select: { status: true } });
      if (pending && (pending.status === "QUEUED" || pending.status === "RUNNING")) return null;
    }
    if (state.sourceHash === current.hash && state.account === connection.email && state.url && !state.error) return null;
    if (!retry && state.error && state.attemptedHash === current.hash && state.account === connection.email) return null;
    const job = await tx.job.create({ data: { type: driveArchiveJob.type, key: `drive-sync:${id}`, applicationId: id, input: { id, account: connection.email } }, select: { id: true } });
    await tx.application.update({ where: { id }, data: { driveSync: { ...state, attemptedHash: current.hash, account: connection.email, error: null, jobId: job.id }, updatedAt: row.updatedAt } });
    return job.id;
  });
  if (queued) {
    const { dispatchJob } = await import("@/lib/jobs/runner");
    await dispatchJob(queued);
  }
  return readDriveSync(id);
}

/** Used after successful document mutations; failures never undo the user's saved application. */
export async function scheduleDriveSyncQuietly(id: string) {
  try { await ensureDriveSync(id); } catch { console.error("Drive auto-save could not be queued; it will be checked again when the application is opened."); }
}

class SourceChanged extends Error {}
class AutoSaveDisabled extends Error {}
export async function runDriveSync(id: string, account: string, jobId: string, signal?: AbortSignal): Promise<{ url: string; sourceHash: string }> {
  const current = await source(id);
  if (current.state.sourceHash === current.hash && current.state.account === account && current.state.url && !current.state.error && !current.state.jobId) {
    return { url: current.state.url, sourceHash: current.hash };
  }
  try {
    if (!(await loadSettings()).driveAutoSave) throw new AutoSaveDisabled();
    signal?.throwIfAborted();
    if ((await loadGoogleAccount())?.email !== account) throw new GoogleError("not-connected", "The connected Google account changed. Retry Drive sync with the current account.");
    await accessToken("drive");
    const result = await archiveApplicationToDrive(id, async () => {
      signal?.throwIfAborted();
      if (!(await loadSettings()).driveAutoSave) throw new AutoSaveDisabled();
      if ((await source(id)).hash !== current.hash) throw new SourceChanged();
    });
    signal?.throwIfAborted();
    await prisma.$transaction(async tx => {
      const row = await tx.application.findUnique({ where: { id }, select: { driveSync: true, updatedAt: true } });
      if (!row || parseDriveSync(row.driveSync).jobId !== jobId) return;
      await tx.application.update({ where: { id }, data: { driveSync: { sourceHash: current.hash, attemptedHash: current.hash, account, url: result.url, syncedAt: new Date().toISOString(), error: null, jobId: null }, updatedAt: row.updatedAt } });
    });
    await saveSettings({ driveSyncProblem: null });
    return { url: result.url, sourceHash: current.hash };
  } catch (error) {
    const row = await prisma.application.findUnique({ where: { id }, select: { driveSync: true, updatedAt: true } });
    if (row && parseDriveSync(row.driveSync).jobId === jobId) {
      const state = parseDriveSync(row.driveSync);
      const message = error instanceof GoogleError ? error.message : "Drive auto-save failed. Check the background job and retry; ZIP downloads still work.";
      await prisma.application.update({ where: { id }, data: { driveSync: error instanceof SourceChanged || error instanceof AutoSaveDisabled
        ? { ...state, attemptedHash: undefined, error: null, jobId: null }
        : { ...state, error: message, jobId: null }, updatedAt: row.updatedAt } });
      if (error instanceof GoogleError) await saveSettings({ driveSyncProblem: message });
    }
    if (error instanceof SourceChanged || error instanceof AutoSaveDisabled) return { url: "", sourceHash: "" };
    throw error;
  }
}
