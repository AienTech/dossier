import "server-only";
import { z } from "zod";
import { defineJob } from "./runner";
import { runDriveSync } from "@/lib/google/drive-sync";

export const driveArchiveJob = defineJob({
  type: "archive-application-drive",
  input: z.object({ id: z.string().min(1), account: z.string().min(1) }),
  result: z.object({ url: z.string(), sourceHash: z.string() }),
  async run({ id, account }, context) {
    await context.step("Saving application packet to Google Drive");
    return runDriveSync(id, account, context.id, context.signal);
  },
});
