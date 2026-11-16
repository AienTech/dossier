import "server-only";
import { usesSqlite } from "@/lib/database";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

const CONTROL_LOCK = 714_392_652;

const hourSetting = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 23) throw new Error(`${name} must be an hour from 0 to 23.`);
  return value;
};

/** The nightly window, in UTC hours, when an idle worker stays warm. */
const workerWindow = (): { start: number; end: number } => ({
  start: hourSetting("HIREME_WORKER_WINDOW_START", 16),
  end: hourSetting("HIREME_WORKER_WINDOW_END", 22),
});

/** A window may wrap past midnight, so 22–06 is as valid as 09–17. */
export const workerWindowOpen = (now = new Date()): boolean => {
  const { start, end } = workerWindow();
  if (start === end) return false;
  const hour = now.getUTCHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
};

/** The same window for people: shown in the connector's job status. */
export function workerWindowLabel(): string {
  const { start, end } = workerWindow();
  const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  return `${pad(start)}–${pad(end)} UTC`;
}

/** The deployment's own worker daemon; no platform credentials are exposed. */
function workerTarget(): { url: string; region: string } {
  const project = process.env.HIREME_WORKER_PROJECT_ID;
  const team = process.env.HIREME_WORKER_TEAM_ID;
  if (!project || !team) throw new Error("Cloud worker scaling is not configured.");
  const daemon = process.env.HIREME_WORKER_DAEMON || "hireme-worker";
  const region = process.env.HIREME_WORKER_REGION || "fra1";
  const segment = (value: string) => encodeURIComponent(value);
  return {
    url: `https://api.vercel.com/v1/projects/${segment(project)}/daemons/${segment(daemon)}/instances?teamId=${segment(team)}`,
    region,
  };
}

/** Fixed project/daemon, 0 or 1 instance only. Never exposes platform credentials. */
async function scale(count: 0 | 1): Promise<void> {
  // A SQLite install runs one process: there is no second container to start.
  if (usesSqlite()) throw new Error("A cloud worker needs PostgreSQL; an SQLite install runs in one process.");
  const token = process.env.HIREME_WORKER_VERCEL_TOKEN;
  if (process.env.VERCEL_ENV !== "production" || !token) throw new Error("Cloud worker scaling is not configured.");
  const { url, region } = workerTarget();
  const response = await fetch(url, {
    method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ [region]: count }), signal: AbortSignal.timeout(15000), redirect: "error",
  });
  const result = await response.json().catch(() => null) as { ok?: boolean } | null;
  if (!response.ok || result?.ok !== true) throw new Error(`Vercel did not confirm worker scaling (HTTP ${response.status}).`);
}
async function locked<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => { await tx.$queryRaw`SELECT pg_advisory_xact_lock(${CONTROL_LOCK})::text`; return work(tx); }, { timeout: 25000, maxWait: 10000 });
}
/** A new interactive job wakes the worker even outside its nightly window. */
export async function wakeCloudWorker(): Promise<boolean> {
  try {
    await locked(async tx => {
      await scale(1);
      const value = new Date().toISOString();
      await tx.setting.upsert({ where: { key: "workerWakeRequestedAt" }, create: { key: "workerWakeRequestedAt", value }, update: { value } });
    });
    return true;
  } catch { console.error("The cloud worker could not be started; queued jobs remain saved."); return false; }
}
/** The schedule and idle worker share the lock with wake-up to avoid lost work. */
export async function reconcileCloudWorker({ idle = false, now = new Date() } = {}): Promise<0 | 1> {
  return locked(async tx => {
    const pending = await tx.job.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } });
    const count = workerWindowOpen(now) || pending > 0 ? 1 : 0;
    // Idle checks never start another instance; the current worker is already up.
    if (!idle || count === 0) await scale(count);
    return count;
  });
}
