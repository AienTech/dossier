import "server-only";
import { z } from "zod";
import { checkInboxNow } from "@/lib/google/sync";
import { GoogleError } from "@/lib/google/errors";
import { defineJob } from "./runner";
export const INBOX_JOB_KEY = "check-job-email-once";
export const checkInboxJob = defineJob({
  type: "check-job-email", input: z.object({ days: z.number().int().min(1).max(90).default(30), applyUpdates: z.boolean().default(true) }),
  result: z.object({ fetched: z.number(), kept: z.number(), read: z.number(), updated: z.number(), reviewNeeded: z.number() }),
  async run({ days, applyUpdates }, { step, signal }) {
    await step("Checking Gmail access");
    const result = await checkInboxNow({ signal, jobOnly: true, lookbackDays: days, applyUpdates, progress: step });
    if (!result) throw new GoogleError("unavailable", "Another inbox check is running. Wait for it to finish, then retry this job.");
    return { ...result, updated: result.updated ?? 0, reviewNeeded: result.reviewNeeded ?? 0 };
  },
});
export type InboxCheckResult = z.infer<typeof checkInboxJob.result>;
