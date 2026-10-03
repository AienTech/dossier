import "server-only";

import { z } from "zod";

import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { extractProfile } from "@/lib/ai/tasks";
import { IMPORT_PROFILE_STEPS, importedProfileSchema } from "@/lib/profile-import";
import { MAX_RESUME_CHARACTERS } from "@/lib/resume-text";

import { defineJob } from "./runner";

/**
 * Sorts a resume's text into a profile (E4-10, PRO-12). Saves nothing: the
 * result waits in the job until the user merges or replaces with it.
 */
export const importProfileJob = defineJob({
  type: "import-profile",
  input: z.object({ resume: z.string().trim().min(1).max(MAX_RESUME_CHARACTERS) }),
  result: z.object({ profile: importedProfileSchema, readWith: z.string() }),
  async run({ resume }, { step, signal }) {
    await step(IMPORT_PROFILE_STEPS[0]);
    const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
    await step(IMPORT_PROFILE_STEPS[1]);
    const { data, promptVersion } = await extractProfile(provider, { resume }, { ...options, signal });
    return { profile: data, readWith: promptVersion };
  },
});

export type ImportProfileResult = z.infer<typeof importProfileJob.result>;
