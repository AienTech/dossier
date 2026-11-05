import { z } from "zod";

import { unitsSchema, type Extracted, type Match, type Unit } from "@/lib/application-data";
import { publicationLabel } from "@/lib/citation";
import { documentLabels, ENGLISH_LABELS, languagesLine, type DocumentLabels } from "@/lib/document-labels";
import { customSectionUnits } from "@/lib/custom-section-units";
import { certificationLabel, resumeCertifications, resumeCustomSections, resumePublications, sameName, type ProfileData } from "@/lib/profile";
import { inEditorOrder, skillsText } from "@/lib/skill-groups";

import { guardSources, guardUnits } from "../fact-guard";

import {
  applicationFacts,
  candidateFacts,
  CREATIVITY,
  jobForPrompt,
  languageRule,
  NO_EM_DASHES,
  profileForPrompt,
  system,
  truthfulness,
  UNTRUSTED_POSTING,
  type Task,
} from "./prompt-parts";

export const TAILOR_RESUME_VERSION = "tailor-resume@8";

const answerSchema = z.object({
  summary: z.string(),
  roles: z.array(z.object({ id: z.string(), bullets: z.array(z.string()) })),
  projects: z.array(z.object({ id: z.string(), bullets: z.array(z.string()) })),
  /** The profile's skills, most relevant first; leave out ones that don't help. */
  skills: z.array(z.string()),
  education: z.array(z.object({ id: z.string(), notes: z.string() })),
});

const INSTRUCTIONS = `You tailor a candidate's resume to one job, as JSON.

- summary: 2–3 sentences in the first person without "I" at the start of every sentence, about the candidate as this job would see them.
- roles: every role from the profile, by id, with 2–5 bullets each, volunteering too. Lead with what this job cares about, keep each bullet to one line, and start with a verb.
- projects: every project from the profile, by id, with 1–3 bullets each, written like the roles' bullets: what was built and what it shows that this job cares about.
- skills: the candidate's own skills, most relevant to this job first. Copy their names exactly; you may leave out ones that don't help.
- education: every entry by id, with its notes shortened or left empty.
- The profile's certifications, publications and otherSections go on the resume word for word, so don't answer with them; the summary may mention them.`;

/** SET-9: asked for when "Resume length" has a limit; anything still over is trimmed afterwards (E10-10). */
function pageFit(maxPages: number | null | undefined): string | null {
  if (maxPages === 1) {
    return "The resume has to fit on one page: keep the summary to two sentences, give the most relevant roles 3–4 bullets and older roles 2, and keep education and project notes to a few words.";
  }
  if (maxPages === 2) {
    return "The resume has to fit on two pages: keep the summary to three sentences, give the most relevant roles 4–5 bullets and older roles 2–3, and keep education and project notes short.";
  }
  return null;
}

export type TailorInput = {
  profile: ProfileData;
  extracted: Extracted;
  match: Match | null;
  /** What the candidate tells the AI for this application (APP-15). */
  facts: string[];
  /** The posting as pasted, for the fact guard. */
  posting: string;
  /** Keep the profile's order of skills, set by hand, instead of the most relevant first (public issue 62). */
  keepSkillOrder?: boolean;
};

/** APP-4: the tailored resume as units (summary, each role, each project, skills, each degree, each certification, each publication, languages). */
export const tailorResume: Task<TailorInput, Unit[]> = async (provider, { profile, extracted, match, facts, posting, keepSkillOrder = false }, options) => {
  const answer = await provider.complete({
    task: "tailor-resume",
    system: system(
      INSTRUCTIONS,
      pageFit(options.maxPages),
      truthfulness(options.strict),
      candidateFacts(profile, facts),
      CREATIVITY[options.creativity],
      languageRule(options.language),
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile:\n${profileForPrompt(profile)}`,
          `The job:\n${jobForPrompt(extracted, match)}`,
          applicationFacts(facts),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "tailored_resume",
    creativity: options.creativity,
    signal: options.signal,
  });
  // The languages line in the resume's language: the chosen one, or the posting's.
  const units = resumeUnits(profile, answer, documentLabels(options.language ?? extracted.language), { keepSkillOrder });
  // E6-6: in strict mode, note what the profile and posting don't back.
  return {
    data: options.strict ? guardUnits(units, guardSources(profile, extracted, posting, facts)) : units,
    promptVersion: TAILOR_RESUME_VERSION,
  };
};

/**
 * Turns the answer into units, trusting nothing: unknown roles, projects and
 * degrees are dropped, skills must be the profile's own, and a role or
 * project the model skipped keeps its bullets from the profile. The certifications, publications,
 * custom sections and languages come from the profile, all but the languages word for word (#293, #218, #298),
 * and languages with their levels in the words of `labels`.
 */
export function resumeUnits(profile: ProfileData, answer: z.infer<typeof answerSchema>, labels: DocumentLabels = ENGLISH_LABELS, { keepSkillOrder = false } = {}): Unit[] {
  const roles = new Map(answer.roles.map((role) => [role.id, role.bullets]));
  const projects = new Map(answer.projects.map((project) => [project.id, project.bullets]));
  const notes = new Map(answer.education.map((entry) => [entry.id, entry.notes]));
  const kept = [...new Set(answer.skills.flatMap((name) => profile.skills.find((skill) => sameName(skill.name, name)) ?? []))];
  // In the profile's order when the user set one (public issue 62), else as the model ranked them.
  const skills = keepSkillOrder ? inEditorOrder(profile.skills).filter((skill) => kept.includes(skill)) : kept;
  const units: Unit[] = [
    { id: "summary", label: "Summary", text: answer.summary.trim() },
    ...profile.experience.map((entry) => {
      const bullets = (roles.get(entry.id) ?? entry.bullets.split("\n")).map((line) => line.trim()).filter(Boolean);
      return { id: `experience:${entry.id}`, label: `${entry.company || entry.role} ${entry.volunteering ? "volunteering" : "role"}`, text: bullets.join("\n") };
    }),
    ...profile.projects.map((entry) => {
      const bullets = (projects.get(entry.id) ?? entry.bullets.split("\n")).map((line) => line.trim()).filter(Boolean);
      return { id: `project:${entry.id}`, label: `${entry.name || "Untitled"} project`, text: bullets.join("\n") };
    }),
    // Most relevant first, a line per group where its first skill comes (#280).
    { id: "skills", label: "Skills", text: skillsText(skills) },
    ...profile.education.map((entry) => ({
      id: `education:${entry.id}`,
      label: entry.degree || entry.school,
      text: (notes.get(entry.id) ?? entry.notes).trim(),
    })),
    ...resumeCertifications(profile.certifications).map((entry) => ({
      id: `certification:${entry.id}`,
      label: certificationLabel(entry.name),
      text: entry.name.trim(),
    })),
    ...resumePublications(profile.publications).map((entry) => ({
      id: `publication:${entry.id}`,
      label: publicationLabel(entry.citation),
      text: entry.citation.trim(),
    })),
    ...resumeCustomSections(profile.customSections).flatMap(customSectionUnits),
    {
      id: "languages",
      label: "Languages",
      text: languagesLine(profile.languages, labels),
    },
  ];
  return unitsSchema.parse(units);
}

/** The resume's units with the profile's own words, for adding a section to a resume that exists (#297). */
export function profileUnits(profile: ProfileData, labels: DocumentLabels = ENGLISH_LABELS): Unit[] {
  return resumeUnits(
    profile,
    { summary: profile.basics.summary, roles: [], projects: [], skills: inEditorOrder(profile.skills).map((skill) => skill.name), education: [] },
    labels,
  );
}
