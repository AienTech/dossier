import { z } from "zod";

// What the user wants from a job, beyond what the profile shows (salary,
// place, company size, ...), each with how much it counts. Both scorers
// weigh them: a must-have that a posting misses keeps it a poor fit.

export const CRITERION_IMPORTANCE = ["NICE", "IMPORTANT", "MUST"] as const;
export type CriterionImportance = (typeof CRITERION_IMPORTANCE)[number];

export const IMPORTANCE_LABELS: Record<CriterionImportance, string> = { NICE: "Nice to have", IMPORTANT: "Important", MUST: "Must have" };

export const MAX_CRITERIA = 12;

export const scoringCriterionSchema = z.object({
  id: z.string().min(1).max(40),
  /** "Salary", "Location", "Company size". */
  label: z.string().trim().min(1).max(60),
  /** "At least 80k EUR a year", "Berlin or remote in the EU", "Under 200 people". */
  preference: z.string().trim().min(1).max(300),
  importance: z.enum(CRITERION_IMPORTANCE),
});
export type ScoringCriterion = z.infer<typeof scoringCriterionSchema>;

/** Whether a posting meets a criterion: yes, no, or it doesn't say. */
export type CriterionMet = "yes" | "no" | "unknown";

/** A posting that misses a must-have scores no higher than this: a poor fit. */
export const MUST_CAP = 49;
/** What a missed criterion costs the Jev score. */
export const MISSED_PENALTY: Record<Exclude<CriterionImportance, "MUST">, number> = { IMPORTANT: 10, NICE: 3 };

/** The score with the must-have cap applied. */
export function cappedScore(score: number, results: readonly { importance: CriterionImportance; met: CriterionMet }[]): number {
  return results.some((result) => result.importance === "MUST" && result.met === "no") ? Math.min(score, MUST_CAP) : score;
}

/** The lines a score shows for the criteria: met ones as reasons, missed ones as red flags. */
export function criteriaLines(results: readonly { label: string; importance: CriterionImportance; met: CriterionMet }[]): { reasons: string[]; redFlags: string[] } {
  return {
    reasons: results.filter((result) => result.met === "yes").map((result) => `Meets: ${result.label}`),
    redFlags: results
      .filter((result) => result.met === "no")
      .map((result) => `Doesn't meet: ${result.label}${result.importance === "MUST" ? " (must have)" : ""}`),
  };
}

/** Whether a score was made with other criteria than `criteria`: what `scoredWith` ends with against today's tag. */
export function criteriaChanged(scoredWith: string, criteria: readonly ScoringCriterion[]): boolean {
  const used = / \+criteria:[0-9a-f]{8}$/.exec(scoredWith)?.[0] ?? "";
  return used !== criteriaTag(criteria);
}

/** A short tag for a set of criteria, kept with each score so it shows which criteria it was scored with. */
export function criteriaTag(criteria: readonly ScoringCriterion[]): string {
  if (criteria.length === 0) return "";
  const text = JSON.stringify(criteria.map(({ label, preference, importance }) => [label, preference, importance]));
  // FNV-1a: short and the same everywhere; not for security.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ` +criteria:${hash.toString(16).padStart(8, "0")}`;
}
