import "server-only";

import { setTimeout as delay } from "node:timers/promises";

import { Client } from "pg";

import { logServerError } from "@/lib/log";
import { pollDatabaseQueue } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { reconcileCloudWorker, workerWindowOpen } from "@/lib/worker-scaling";

// A session lock survives transactions. Use Neon's DIRECT URL here: session
// locks cannot be held through a transaction-pooling connection string.
// During deployments the new worker waits until the previous process exits,
// so startup recovery cannot interrupt another worker's jobs or schedules.
const LEADER_LOCK = 714_392_651;
let leader: Client | undefined;

export async function acquireWorkerLeadership(): Promise<void> {
  if (leader) return;
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) throw new Error("The cloud worker needs DATABASE_URL_UNPOOLED (a direct PostgreSQL connection).");
  if (new URL(connectionString).hostname.includes("-pooler.")) throw new Error("The cloud worker needs a direct database URL, not a pooled Neon URL.");
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000, keepAlive: true });
  client.on("error", () => {
    // Loss of the lock's connection means this process must stop immediately;
    // another worker may acquire leadership. Never continue on a lost lease.
    console.error("Cloud worker lost its database connection; stopping.");
    process.exit(1);
  });
  await client.connect();
  for (;;) {
    const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [LEADER_LOCK]);
    if (result.rows[0]?.acquired) break;
    await delay(2000);
  }
  leader = client;
}

/** Starts only after startup recovery, once the private worker owns the lock. */
export function startCloudQueue(): void {
  if (!leader) throw new Error("The cloud worker does not own leadership.");
  const client = leader;
  let lastHeartbeat = 0;
  let lastBusyAt = Date.now();
  let lastIdleCheck = 0;
  const poll = async () => {
    try {
      await client.query("SELECT 1");
    } catch {
      console.error("Cloud worker lost leadership; stopping.");
      process.exit(1);
    }
    if (Date.now() - lastHeartbeat >= 60_000) {
      try {
        // Prisma supplies Setting.updatedAt, which has no database default.
        // Monitoring must never terminate a worker that still owns its lock.
        const value = new Date().toISOString();
        await prisma.setting.upsert({ where: { key: "workerHeartbeat" }, create: { key: "workerHeartbeat", value }, update: { value } });
        lastHeartbeat = Date.now();
      } catch (error) { logServerError("worker heartbeat", error); }
    }
    try {
      await pollDatabaseQueue();
      if (Date.now() - lastIdleCheck >= 15000) {
        lastIdleCheck = Date.now();
        const pending = await prisma.job.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } });
        const { inboxCheckRunning } = await import("@/lib/google/sync");
        if (pending || inboxCheckRunning()) lastBusyAt = Date.now();
        if (!workerWindowOpen() && Date.now() - lastBusyAt >= 120000) {
          if (await reconcileCloudWorker({ idle: true }) === 0) return;
          lastBusyAt = Date.now();
        }
      }
    } catch (error) {
      logServerError("cloud queue", error);
    }
    setTimeout(() => void poll(), 1000).unref();
  };
  void poll();
}
