import { timingSafeEqual } from "node:crypto";
import { reconcileCloudWorker } from "@/lib/worker-scaling";

export const dynamic = "force-dynamic";

/** Only Vercel's authenticated scheduler may change this project's worker. */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const reply = (body: object, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return reply({ error: "Unauthorized" }, 401);
  }
  const token = process.env.HIREME_WORKER_VERCEL_TOKEN;
  if (process.env.VERCEL_ENV !== "production" || !token) {
    return reply({ error: "Worker scheduling is not configured for this environment." }, 503);
  }
  try {
    // A scheduled stop drains queued/running work before the idle worker stops.
    const count = await reconcileCloudWorker();
    return reply({ ok: true, instances: count, timeZone: "UTC" }, 200);
  } catch {
    console.error("Worker scaling request failed");
    return reply({ error: "Could not reach Vercel to scale the worker." }, 502);
  }
}
