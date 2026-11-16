import "server-only";

import { searchPostings } from "@/lib/job-search";
import { credentialsFor, requestContext, type JobSearchConfig } from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { postingKey, type FoundPosting, type SearchPage, type SearchQuery } from "@/lib/job-search/search";
import { worldwideCountries } from "@/lib/job-search/worldwide";

import { agentDedupeKey } from "./candidates";
import { channelForSource, tagDiscoverChannel } from "./discover-channel";
import {
  AGENT_SOURCES,
  asSearchQuery,
  filterBySponsorship,
  withSponsorshipBias,
  type AgentQuery,
  type AgentSource,
} from "./query";
import { DEFAULT_COMPANY_RESULT_PAGES, type WatchedCompany } from "./watched-companies";

/** How many source requests to run at once. */
const FANOUT_CONCURRENCY = 3;

export type AgentSearchPlan = {
  source: AgentSource;
  query: SearchQuery;
  /** Why this plan exists, for logs / tests. */
  reason: "base" | "company";
  company?: string;
};

/**
 * Agent-capable sources that currently have credentials. `selected` empty
 * means all of them; BA is never included.
 */
export function readyAgentSources(config: JobSearchConfig, selected: readonly AgentSource[] = []): AgentSource[] {
  const wanted =
    selected.length > 0 ? selected.filter((source): source is AgentSource => (AGENT_SOURCES as readonly string[]).includes(source)) : [...AGENT_SOURCES];
  const ready: AgentSource[] = [];
  for (const source of wanted) {
    try {
      credentialsFor(config, source);
      ready.push(source);
    } catch (error) {
      if (!(error instanceof JobSearchError)) throw error;
    }
  }
  return ready;
}

/**
 * Expand an empty-country plan into one plan per worldwide country. FreeHire
 * already searches globally without a country, so it stays as one plan.
 * JSearch/Adzuna need a country code per request even when they cover most places.
 */
function expandWorldwidePlan(plan: AgentSearchPlan): AgentSearchPlan[] {
  if (plan.query.country) return [plan];
  if (plan.source === "FREEHIRE") return [plan];
  const countries = worldwideCountries(plan.source);
  if (countries.length === 0) return [plan];
  return countries.map((country) => ({ ...plan, query: { ...plan.query, country } }));
}

/**
 * Build the searches for one agent run: one base search per ready source,
 * plus one company search per entry in `companies` (FreeHire when ready, else
 * the first ready source). Empty country → worldwide fan-out. Caller chooses
 * the company batch (rotation / cursor).
 */
export function buildAgentSearchPlans(
  query: AgentQuery,
  sources: readonly AgentSource[],
  companies: readonly WatchedCompany[],
): AgentSearchPlan[] {
  if (sources.length === 0) return [];
  const biased = withSponsorshipBias(query);
  const plans: AgentSearchPlan[] = sources.map((source) => ({ source, query: biased, reason: "base" }));

  const companySource: AgentSource = sources.includes("FREEHIRE") ? "FREEHIRE" : sources[0];
  for (const company of companies) {
    const keywords = `${asSearchQuery(query).keywords} ${company.name}`.trim().slice(0, 200);
    const companyQuery = withSponsorshipBias({ ...query, keywords });
    plans.push({ source: companySource, query: companyQuery, reason: "company", company: company.name });
  }
  return plans.flatMap(expandWorldwidePlan);
}

/** Merge pages and drop duplicate postings (same source id or same link/company key). */
export function mergeAgentPostings(pages: readonly FoundPosting[][]): FoundPosting[] {
  const seen = new Set<string>();
  const merged: FoundPosting[] = [];
  for (const page of pages) {
    for (const posting of page) {
      const keys = [postingKey(posting), agentDedupeKey(posting)];
      if (keys.some((key) => seen.has(key))) continue;
      for (const key of keys) seen.add(key);
      merged.push(posting);
    }
  }
  return merged;
}

async function mapPool<T, R>(items: readonly T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Fetch up to `pageLimit` pages for one plan (follows opaque `next` cursors). */
async function searchPlanPages(
  plan: AgentSearchPlan,
  config: JobSearchConfig,
  pageLimit: number,
): Promise<FoundPosting[]> {
  const credentials = credentialsFor(config, plan.source);
  const context = requestContext(plan.source);
  const collected: FoundPosting[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < pageLimit; page += 1) {
    const result: SearchPage = await searchPostings(plan.source, credentials, plan.query, cursor, context);
    collected.push(...result.postings);
    if (!result.next) break;
    cursor = result.next;
  }
  return collected;
}

/**
 * Run every plan (with optional extra pages on company searches), merge, then
 * apply sponsorship require-filter. Soft-fails known source errors.
 */
export async function runAgentFanout(
  config: JobSearchConfig,
  query: AgentQuery,
  companies: readonly WatchedCompany[],
  options: { companyPages?: number } = {},
): Promise<{ postings: FoundPosting[]; plans: number; failures: number; errors: string[] }> {
  const sources = readyAgentSources(config, query.sources);
  const plans = buildAgentSearchPlans(query, sources, companies);
  const companyPages = Math.max(1, options.companyPages ?? DEFAULT_COMPANY_RESULT_PAGES);
  const errors: string[] = [];
  let failures = 0;
  const pages = await mapPool(plans, FANOUT_CONCURRENCY, async (plan) => {
    try {
      const limit = plan.reason === "company" ? companyPages : 1;
      const raw = await searchPlanPages(plan, config, limit);
      const channel = channelForSource(plan.source);
      return raw.map((posting) => tagDiscoverChannel(posting, channel, plan.reason === "company" ? plan.company : undefined));
    } catch (error) {
      // Soft-fail known source problems (quota, key, country); unexpected errors still abort the run.
      if (!(error instanceof JobSearchError)) throw error;
      failures += 1;
      errors.push(error.message);
      return [] as FoundPosting[];
    }
  });
  const merged = mergeAgentPostings(pages);
  return { postings: filterBySponsorship(merged, query.sponsorship), plans: plans.length, failures, errors };
}
