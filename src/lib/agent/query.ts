import { z } from "zod";

import { PostingSource } from "@/generated/prisma/enums";
import {
  DEFAULT_RADIUS_KM,
  EMPTY_QUERY,
  searchQuerySchema,
  type FoundPosting,
  type JobSource,
  type SearchQuery,
} from "@/lib/job-search/search";

// Agent search (extends Find jobs): sponsorship preference and which sources
// to fan out across. Empty sources means every source that has credentials.

/** Sources the job agent may search; never the Bundesagentur für Arbeit. */
export const AGENT_SOURCES = [PostingSource.JSEARCH, PostingSource.ADZUNA, PostingSource.FREEHIRE] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

export const SPONSORSHIP_MODES = ["any", "prefer", "require"] as const;
export type SponsorshipMode = (typeof SPONSORSHIP_MODES)[number];

export const SPONSORSHIP_LABELS: Record<SponsorshipMode, string> = {
  any: "Any (no filter)",
  prefer: "Prefer sponsorship / relocation",
  require: "Require sponsorship / relocation",
};

export const agentQuerySchema = searchQuerySchema.extend({
  /** Whether to bias (or require) visa sponsorship / relocation language. */
  sponsorship: z.enum(SPONSORSHIP_MODES).default("any"),
  /**
   * Which sources to search. Empty = every agent-capable source that has
   * credentials configured.
   */
  sources: z.array(z.enum(AGENT_SOURCES)).max(AGENT_SOURCES.length).default([]),
});
export type AgentQuery = z.output<typeof agentQuerySchema>;

export const EMPTY_AGENT_QUERY: AgentQuery = {
  ...EMPTY_QUERY,
  sponsorship: "any",
  sources: [],
};

/** Lift a Find-jobs search into an agent query (defaults for new fields). */
export function asAgentQuery(query: SearchQuery): AgentQuery {
  return agentQuerySchema.parse({ ...EMPTY_AGENT_QUERY, ...query });
}

/** The fields every job-source adapter understands. */
export function asSearchQuery(query: AgentQuery): SearchQuery {
  const { keywords, place, country, radiusKm, remoteOnly, postedWithin } = query;
  return { keywords, place, country, radiusKm, remoteOnly, postedWithin };
}

/** Region hints for sponsorship / relocation keyword bias. */
export function sponsorshipBiasTerms(country: string): string {
  const code = country.trim().toLowerCase();
  if (code === "us") return "visa sponsorship H-1B relocation";
  if (["de", "at", "nl", "be", "fr", "es", "it", "pt", "ie", "se", "dk", "fi", "pl", "cz"].includes(code)) {
    return "visa sponsorship Blue Card relocation";
  }
  if (["ae", "sa", "qa", "kw", "bh", "om", "eg", "jo"].includes(code)) {
    return "visa sponsorship relocation";
  }
  if (code === "gb" || code === "uk") return "visa sponsorship Skilled Worker relocation";
  return "visa sponsorship relocation";
}

/**
 * Keywords sent to the APIs when sponsorship is prefer/require: append
 * region-aware terms without exceeding the keywords cap.
 */
export function withSponsorshipBias(query: AgentQuery): SearchQuery {
  const base = asSearchQuery(query);
  if (query.sponsorship === "any") return base;
  const extra = sponsorshipBiasTerms(query.country);
  const keywords = `${base.keywords} ${extra}`.trim().slice(0, 200);
  return { ...base, keywords };
}

/** Loose match for sponsorship / relocation language in a posting. */
const SPONSORSHIP_RE =
  /\b(visa\s*sponsor(?:ship|ed)?|sponsorship|h-?1b|blue\s*card|skilled\s*worker|relocation|work\s*permit|sponsor(?:s|ed|ship)?)\b/i;

export function mentionsSponsorship(posting: Pick<FoundPosting, "title" | "description" | "place" | "salary">): boolean {
  return SPONSORSHIP_RE.test([posting.title, posting.description, posting.place, posting.salary].join("\n"));
}

/** Drop postings that don't mention sponsorship when mode is require. */
export function filterBySponsorship<T extends Pick<FoundPosting, "title" | "description" | "place" | "salary">>(
  postings: readonly T[],
  mode: SponsorshipMode,
): T[] {
  if (mode !== "require") return [...postings];
  return postings.filter(mentionsSponsorship);
}

/** Whether a source id is one the agent may use. */
export const isAgentSource = (source: JobSource): source is AgentSource => (AGENT_SOURCES as readonly string[]).includes(source);

/** Radius default used when lifting partial queries in tests. */
export const AGENT_DEFAULT_RADIUS_KM = DEFAULT_RADIUS_KM;
