import "server-only";

import { credentialsFor, loadJobSearchConfig, requestContext } from "./config";
import { mergePostings } from "./dedupe";
import { JobSearchError } from "./errors";
import { postingDetails, searchPostings } from "./index";
import type { FoundPosting, JobSource, SearchProblem, SearchQuery, SourceResult, StoredPosting } from "./search";

// Asking job sources from Find jobs (E14-6): one page from each, merged,
// and what went wrong in words for the screen. Kept searches are in
// src/lib/posting-searches.ts.

/**
 * A page for `query` from each of `sources`, the ones chosen in Settings
 * unless given (a kept search goes on with the sources it ran on). Sources
 * are asked one after another. With `cursors`, only the sources that have a
 * next page are asked. A source that fails is noted in its result; only
 * when every source fails is the search a problem.
 */
export async function askSources(
  query: SearchQuery,
  { sources, cursors }: { sources?: readonly JobSource[]; cursors?: readonly SourceResult[] } = {},
): Promise<{ ok: true; postings: StoredPosting[]; results: SourceResult[] } | SearchProblem> {
  const config = await loadJobSearchConfig();
  const from = sources ?? config.sources;
  if (from.length === 0) return { ok: false, problem: "off", message: "Choose where to search in Settings → Job search first." };
  if (!query.country) return { ok: false, problem: "no-country", message: "Choose a country to search in." };

  const lists: FoundPosting[][] = [];
  const results: SourceResult[] = [];
  let firstProblem: SearchProblem | null = null;
  for (const source of from) {
    const next = cursors ? (cursors.find((entry) => entry.source === source)?.next ?? null) : null;
    if (cursors && next === null) continue;
    try {
      const page = await searchPostings(source, credentialsFor(config, source), query, next, requestContext(source));
      lists.push(page.postings);
      results.push({ source, found: page.postings.length, next: page.next, problem: null });
    } catch (error) {
      if (!(error instanceof JobSearchError)) throw error;
      firstProblem ??= { ok: false, problem: error.problem, message: error.message };
      results.push({ source, found: 0, next: null, problem: error.message });
    }
  }
  if (firstProblem && results.every((result) => result.problem !== null)) return firstProblem;
  return { ok: true, postings: mergePostings(lists), results };
}

/**
 * The whole text of a posting, from its own source (which may no longer be
 * one chosen, for a saved posting); null when it can't be had.
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
