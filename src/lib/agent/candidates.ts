import type { Prisma } from "@/generated/prisma/client";
import type { PostingSource } from "@/generated/prisma/enums";
import { agentDedupeKey } from "@/lib/job-search/dedupe";
import type { FoundPosting } from "@/lib/job-search/search";

export { agentDedupeKey };

/** What the agent scores: a posting from a saved search, or a startup from Startups (#222), whose source is STARTUP. */
export type AgentPosting = Omit<FoundPosting, "source"> & { source: PostingSource; startupId?: string };

// The job agent's candidates (E16): postings it found and scored. A dismissed
// one stays, so the posting never comes back, but keeps only what dedupe
// needs.

/** A posting as a new candidate, with its score. */
export function candidateData(posting: AgentPosting, score: { score: number; reasons: string[]; redFlags: string[] }, scoredWith = ""): Prisma.AgentCandidateCreateInput {
  return {
    source: posting.source,
    externalId: posting.externalId,
    title: posting.title,
    company: posting.company,
    place: posting.place,
    remote: posting.remote,
    salary: posting.salary,
    postedAt: posting.postedAt ? new Date(posting.postedAt) : null,
    url: posting.url,
    via: posting.via,
    description: posting.description,
    complete: posting.complete,
    score: score.score,
    reasons: score.reasons,
    redFlags: score.redFlags,
    scoredWith,
    dedupeKey: agentDedupeKey(posting),
    ...(posting.startupId ? { startup: { connect: { id: posting.startupId } } } : {}),
  };
}

/**
 * What a dismissed candidate gives up (#191): everything but its source, the
 * source's id, its dedupe key, title and company, which say what it was.
 */
export const DISMISSED_TRIM = {
  place: "",
  remote: null,
  salary: "",
  postedAt: null,
  url: "",
  via: "",
  description: "",
  complete: false,
  reasons: [],
  redFlags: [],
  error: null,
  applicationId: null,
} satisfies Prisma.AgentCandidateUncheckedUpdateInput;

/** A JSON list of strings, as reasons and red flags are stored; anything else reads as none. */
export function stringsOf(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
