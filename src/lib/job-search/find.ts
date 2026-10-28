import "server-only";

import { compileBlocklist, isBlockedPosting } from "./blocklist";
import { credentialsFor, loadJobSearchConfig, requestContext, type JobSearchConfig } from "./config";
import { JobSearchError } from "./errors";
import { postingDetails, searchPostings } from "./index";
import { JOB_SOURCES, type FoundPosting, type JobSource, type SearchPage, type SearchProblem, type SearchQuery } from "./search";
import { SOURCE_INFO } from "./sources";

// Asking a job source from Find jobs (E14-6): a page of postings, or what
// went wrong in words for the screen. Kept searches are in
// src/lib/posting-searches.ts.

export type SourceAnswer = ({ ok: true; source: JobSource } & SearchPage) | SearchProblem;

/**
 * The order to try sources in for a fresh search (this fork, E14-9): the
 * one chosen in Settings first, then the rest in the order Settings lists
 * them.
 */
function fallbackOrder(primary: JobSource): JobSource[] {
  return [primary, ...JOB_SOURCES.filter((source) => source !== primary)];
}

/**
 * One page for `query`, trying every source with a key saved — starting
 * from `primary` — until one answers (this fork, E14-9): one source's
 * exhausted quota, an outage, or a country it doesn't cover no longer stops
 * a search, it just moves on to the next. A source with no key saved (or,
 * for the Bundesagentur für Arbeit, not yet switched on) is skipped without
 * being asked at all. Shared by askSource below and the job agent's search
 * step (src/lib/agent/run.ts), so both get the same resilience; the agent
 * excludes the Bundesagentur für Arbeit itself (it never searches it, #223).
 */
export async function searchWithFallback(
  config: JobSearchConfig,
  primary: JobSource,
  query: SearchQuery,
  next: string | null = null,
  { exclude = [] }: { exclude?: readonly JobSource[] } = {},
): Promise<SourceAnswer> {
  // A source with no key saved (or, for the Bundesagentur für Arbeit, not yet switched on) was never asked, so it's
  // not a failed attempt — it's skipped silently, the way it would be if it didn't exist. The one exception is the
  // primary source itself: if nothing else is configured either, its own "add a key" message is the most useful
  // thing to say, same as before there was anything to fall back to.
  let primaryNotConfigured: SearchProblem | null = null;
  const attempts: { source: JobSource; problem: SearchProblem }[] = [];
  for (const candidate of fallbackOrder(primary)) {
    if (exclude.includes(candidate)) continue;
    let credentials;
    try {
      credentials = credentialsFor(config, candidate);
    } catch (error) {
      if (!(error instanceof JobSearchError)) throw error;
      if (candidate === primary) primaryNotConfigured = { ok: false, problem: error.problem, message: error.message };
      continue;
    }
    try {
      const page = await searchPostings(candidate, credentials, query, next, requestContext(candidate));
      return { ok: true, source: candidate, ...page };
    } catch (error) {
      if (!(error instanceof JobSearchError)) throw error;
      attempts.push({ source: candidate, problem: { ok: false, problem: error.problem, message: error.message } });
    }
  }
  if (attempts.length === 0) return primaryNotConfigured ?? { ok: false, problem: "off", message: "Choose where to search in Settings → Job search first." };
  if (attempts.length === 1) return attempts[0].problem;
  return {
    ok: false,
    problem: attempts[0].problem.problem,
    message: `None of your job sources could answer. ${attempts.map((a) => `${SOURCE_INFO[a.source].name}: ${a.problem.message}`).join(" ")}`,
  };
}

/**
 * One page for `query` from `source`, the one chosen in Settings unless
 * given (a kept search goes on with the exact source it ran on — its `next`
 * cursor only means something there, so a fresh search's fallback across
 * sources doesn't apply to "Show more"). Postings from a blocked company
 * (this fork, E14-8) never reach the caller — Find jobs, the job agent and
 * the Claude connector's search_jobs all call this, so a blocked name stays
 * out everywhere a search runs, not just on screen.
 */
export async function askSource(query: SearchQuery, { source, next = null }: { source?: JobSource; next?: string | null } = {}): Promise<SourceAnswer> {
  const config = await loadJobSearchConfig();
  if (!query.country) return { ok: false, problem: "no-country", message: "Choose a country to search in." };
  const blocked = compileBlocklist(config.blockedCompanies);
  const withoutBlocked = (answer: SourceAnswer): SourceAnswer =>
    answer.ok ? { ...answer, postings: answer.postings.filter((posting) => !isBlockedPosting(posting, blocked)) } : answer;

  if (source) {
    try {
      const page = await searchPostings(source, credentialsFor(config, source), query, next, requestContext(source));
      return withoutBlocked({ ok: true, source, ...page });
    } catch (error) {
      if (error instanceof JobSearchError) return { ok: false, problem: error.problem, message: error.message };
      throw error;
    }
  }

  if (!config.source) return { ok: false, problem: "off", message: "Choose where to search in Settings → Job search first." };
  return withoutBlocked(await searchWithFallback(config, config.source, query, next));
}

/**
 * The whole text of a posting, from its own source (which may no longer be
 * the one chosen, for a saved posting); null when it can't be had.
 */
export async function fullText(posting: FoundPosting): Promise<string | null> {
  if (posting.complete) return posting.description;
  try {
    return await postingDetails(posting.source, credentialsFor(await loadJobSearchConfig(), posting.source), posting, requestContext(posting.source));
  } catch (error) {
    if (error instanceof JobSearchError) return null;
    throw error;
  }
}
