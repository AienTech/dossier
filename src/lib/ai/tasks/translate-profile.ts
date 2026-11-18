import { z } from "zod";

import type { ProfileData } from "@/lib/profile";

import { system, type Task } from "./prompt-parts";

export const TRANSLATE_PROFILE_VERSION = "translate-profile@1";

// New profile → A copy, translated (#148): the copy's own words in another
// language. Only the text a resume prints as written is sent and translated,
// by id; names of companies, schools, projects and certifications, links,
// dates, contact details and references stay as they are.

const translatedSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  skills: z.array(z.object({ id: z.string(), name: z.string(), group: z.string() })),
  experience: z.array(z.object({ id: z.string(), role: z.string(), location: z.string(), descriptor: z.string(), bullets: z.string() })),
  projects: z.array(z.object({ id: z.string(), bullets: z.string() })),
  education: z.array(z.object({ id: z.string(), degree: z.string(), notes: z.string() })),
  customSections: z.array(z.object({ id: z.string(), title: z.string(), items: z.array(z.object({ id: z.string(), title: z.string(), subtitle: z.string(), details: z.string() })) })),
});
export type TranslatedProfile = z.output<typeof translatedSchema>;

/** The parts of a profile that get translated, in the answer's shape. */
export function translatableParts(profile: ProfileData): TranslatedProfile {
  return {
    headline: profile.basics.headline,
    summary: profile.basics.summary,
    skills: profile.skills.map(({ id, name, group }) => ({ id, name, group })),
    experience: profile.experience.map(({ id, role, location, descriptor, bullets }) => ({ id, role, location, descriptor, bullets })),
    projects: profile.projects.map(({ id, bullets }) => ({ id, bullets })),
    education: profile.education.map(({ id, degree, notes }) => ({ id, degree, notes })),
    customSections: profile.customSections.map((section) => ({
      id: section.id,
      title: section.title,
      items: section.items.map(({ id, title, subtitle, details }) => ({ id, title, subtitle, details })),
    })),
  };
}

const INSTRUCTIONS = `You translate a candidate's resume profile into another language, as JSON with exactly the shape, ids and number of items you're given.

- Translate every text field faithfully: same meaning, same facts, same numbers, nothing added or left out. Keep line breaks: each line of "bullets" or "details" stays one line.
- Write as a native speaker writes a resume in that language, with its usual job titles and wording, not word for word.
- Keep as they are: product, tool, programming-language and framework names (Figma, Python, React), company and brand names, acronyms, URLs, and **bold** or *italic* marks.
- An empty field stays empty. Never change an id.`;

export type TranslateProfileInput = { profile: ProfileData; language: string };

/** #148: the profile's own text in another language, matched by id. Contact details and references are never sent. */
export const translateProfile: Task<TranslateProfileInput, TranslatedProfile> = async (provider, { profile, language }, { signal }) => {
  const data = await provider.complete({
    task: "translate-profile",
    system: system(INSTRUCTIONS, "Use only what's in the profile you're given."),
    messages: [{ role: "user", content: `Translate this into ${language}:\n${JSON.stringify(translatableParts(profile), null, 2)}` }],
    schema: translatedSchema,
    schemaName: "translated_profile",
    creativity: "FAITHFUL",
    effort: "low",
    // The whole profile comes back, so it needs more room than most answers.
    maxTokens: 16000,
    signal,
  });
  return { data, promptVersion: TRANSLATE_PROFILE_VERSION };
};
