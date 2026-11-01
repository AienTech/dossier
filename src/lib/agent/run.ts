import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { AiError } from "@/lib/ai/errors";
import { searchPostings } from "@/lib/job-search";
import { agentSources, credentialsFor, loadJobSearchConfig, requestContext, type JobSearchConfig } from "@/lib/job-search/config";
import { mergePostings } from "@/lib/job-search/dedupe";
import { JobSearchError } from "@/lib/job-search/errors";
import { isJobSource, postingKey, type FoundPosting, type JobSource, type SearchPage } from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import { startJob, type JobContext } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { saveScore } from "@/lib/posting-scores";
import { postingStates } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadPostingScorer, scoringProblem } from "@/lib/scoring";
import type { AgentRun, JobSourceBudgets, SettingsData } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import { refreshStartups } from "@/lib/startups/refresh";
import { startupPostingText, startupView } from "@/lib/startups/store";
import { STARTUP_SOURCE_INFO } from "@/lib/startups/types";

import { agentDedupeKey, candidateData, type AgentPosting } from "./candidates";
import { agentDraftJob, draftJobKey } from "./draft";
import { budgetProblem, recordRequest, recordRunEnd, recordRunStart, requestsLeft } from "./runs";
import { agentQueryReady, agentSearchLabel, loadAgentSearches, searchSources, type AgentSearch } from "./searches";

export { agentQueryReady };

// One run of the job agent (E16-3): its saved searches on their sources,
// the postings seen before dropped, and a score for the newest of the rest,
// taken from each search in turn. It never sends anything. Adapted from
// avinashbatchala's fork of Dossier.

export const agentScanResultSchema = z.object({
  /** Postings the source returned. */
  found: z.number().int().min(0),
  /** Of those, the ones not seen before. */
  fresh: z.number().int().min(0),
  scored: z.number().int().min(0),
  drafted: z.number().int().min(0),
  /** Found but seen before: saved, dismissed or applied for in Find jobs, or a candidate already. */
  skipped: z.number().int().min(0),
  /** What to tell the user. */
  message: z.string(),
});
export type AgentScanResult = z.infer<typeof agentScanResultSchema>;

const stopped = (message: string): AgentScanResult => ({ found: 0, fresh: 0, scored: 0, drafted: 0, skipped: 0, message });

/** The sources the agent may ask now: chosen in Settings, not the Bundesagentur für Arbeit, and with their keys. */
function usableSources(config: JobSearchConfig): { sources: JobSource[]; problem: string | null } {
  let problem: string | null = null;
  const sources = agentSources(config).filter((source) => {
    try {
      credentialsFor(config, source);
      return true;
    } catch (error) {
      if (!(error instanceof JobSearchError)) throw error;
      problem ??= error.message;
      return false;
    }
  });
  return { sources, problem };
}

/** Why the saved searches can't run, in words, or null when one can. */
async function searchesProblem(list: readonly AgentSearch[]): Promise<string | null> {
  const enabled = list.filter((search) => search.enabled);
  if (list.length === 0) return "Add a search in Settings → Job agent first.";
  if (enabled.length === 0) return "Turn on a search in Settings → Job agent first.";
  if (!enabled.some((search) => agentQueryReady(search.query))) return "Give a search what to look for and a country in Settings → Job agent first.";
  const config = await loadJobSearchConfig();
  if (agentSources(config).length === 0) {
    // It searches on its own, which the BA's terms forbid most clearly (#223).
    return config.sources.includes("ARBEITSAGENTUR")
      ? "The job agent doesn't search the Bundesagentur für Arbeit. Choose JSearch, Adzuna or FreeHire in Settings → Job search for it."
      : "Choose a job source in Settings → Job search first.";
  }
  const { sources, problem } = usableSources(config);
  return sources.length === 0 ? problem : null;
}

/** Why the agent can't run at all, in words, or null when it's set up. With Startups on, it runs without searches too. */
export async function agentSetupProblem(searches?: readonly AgentSearch[]): Promise<string | null> {
  const [list, settings] = await Promise.all([searches ?? loadAgentSearches(), loadSettings()]);
  const problem = await searchesProblem(list);
  if (problem && !settings.agentStartups) return problem;
  // Scoring is what a run does; drafts ask the AI provider when there are any.
  return scoringProblem();
}

/** Startups refresh before a run takes from them unless they did in this long. */
const STARTUPS_FRESH_MS = 22 * 60 * 60 * 1000;

/**
 * Startups as candidates (#222): refreshed first unless that happened in
 * the past 22 hours, then the best new and saved ones that match well
 * enough, have no application and no candidate yet, and take applications.
 */
async function startupLane(settings: SettingsData, context: JobContext, now: Date): Promise<AgentPosting[]> {
  if (!settings.agentStartups) return [];
  const last = settings.startupsLastRefresh?.at;
  if (!last || now.getTime() - Date.parse(last) >= STARTUPS_FRESH_MS) {
    try {
      await refreshStartups(context.step, context.signal, now);
    } catch (error) {
      if (context.signal.aborted) throw error;
      // What Startups kept before still counts.
      logServerError("job agent startups", error);
    }
  }
  const rows = await prisma.startup.findMany({
    where: { status: { in: ["NEW", "SAVED"] }, score: { gte: settings.agentStartupMinMatch }, applicationId: null, noApplicationsFrom: "", candidates: { none: {} } },
    orderBy: { score: "desc" },
    take: settings.agentMaxScores,
  });
  const postings = rows.map((row): AgentPosting => {
    const startup = startupView(row);
    return {
      source: "STARTUP",
      externalId: startup.id,
      startupId: startup.id,
      title: startup.roles.join(", ") || "Open application",
      company: startup.company,
      place: startup.location,
      remote: startup.remote,
      salary: "",
      postedAt: startup.postedAt,
      url: startup.website,
      via: STARTUP_SOURCE_INFO[startup.source].name,
      description: startupPostingText(startup),
      complete: true,
    };
  });
  const known = new Set((await prisma.agentCandidate.findMany({ where: { dedupeKey: { in: postings.map(agentDedupeKey) } }, select: { dedupeKey: true } })).map((row) => row.dedupeKey));
  return postings.filter((posting) => !known.has(agentDedupeKey(posting)));
}

/** The postings from a page that are new to the agent: not saved, dismissed or applied for, and not a candidate already. */
export async function newPostings(postings: readonly FoundPosting[]): Promise<FoundPosting[]> {
  const states = await postingStates(postings);
  const unseen = postings.filter((posting) => {
    const state = states.get(postingKey(posting));
    return !state?.saved && !state?.dismissed && !state?.applicationId;
  });
  const keys = unseen.map(agentDedupeKey);
  const known = await prisma.agentCandidate.findMany({
    where: { OR: [...unseen.map(({ source, externalId }) => ({ source, externalId })), { dedupeKey: { in: keys } }] },
    select: { source: true, externalId: true, dedupeKey: true },
  });
  const seen = new Set(known.flatMap((candidate) => [postingKey(candidate), candidate.dedupeKey]));
  // The same job twice in one page counts once too.
  return unseen.filter((posting, index) => {
    const fresh = !seen.has(postingKey(posting)) && !seen.has(keys[index]);
    seen.add(keys[index]);
    return fresh;
  });
}

const newestFirst = (a: Pick<FoundPosting, "postedAt">, b: Pick<FoundPosting, "postedAt">) => (b.postedAt ? Date.parse(b.postedAt) : 0) - (a.postedAt ? Date.parse(a.postedAt) : 0);

/**
 * One posting from each lane in turn, newest first within each, each job
 * once (#11): one broad search can't crowd out the others.
 */
export function roundRobin<T extends AgentPosting>(lanes: readonly T[][]): T[] {
  const sorted = lanes.map((lane) => lane.toSorted(newestFirst));
  const taken = new Set<string>();
  const ordered: T[] = [];
  const longest = Math.max(0, ...sorted.map((lane) => lane.length));
  for (let index = 0; index < longest; index += 1) {
    for (const lane of sorted) {
      const posting = lane[index];
      if (!posting) continue;
      const key = agentDedupeKey(posting);
      if (taken.has(key)) continue;
      taken.add(key);
      ordered.push(posting);
    }
  }
  return ordered;
}

/** A saved search's postings from its sources, and how each source did. */
type Lane = { search: AgentSearch; postings: FoundPosting[]; results: AgentRun["searches"] };

/**
 * Asks each enabled search's sources, one request at a time and never in
 * parallel. Each source is asked for up to agentMaxPages pages, while it has
 * a next one, its budget allows, and the search hasn't found agentMaxScores
 * new postings on it yet. Each request is recorded before it's sent.
 */
async function collect(searches: readonly AgentSearch[], settings: SettingsData, context: JobContext, clock: () => Date): Promise<Lane[]> {
  const config = await loadJobSearchConfig();
  const { sources } = usableSources(config);
  let requests = settings.agentRequests;
  const lanes: Lane[] = [];
  for (const search of searches) {
    const lists: FoundPosting[][] = [];
    const results: AgentRun["searches"] = [];
    for (const source of searchSources(search, sources)) {
      const list: FoundPosting[] = [];
      let next: string | null = null;
      let fresh = 0;
      let error: string | null = null;
      for (let page = 0; page < settings.agentMaxPages && !context.signal.aborted; page += 1) {
        if (requestsLeft(requests, settings.jobSourceBudgets, source, clock()) === 0) {
          error = `${SOURCE_INFO[source].name} has used its ${settings.jobSourceBudgets[source as keyof JobSourceBudgets]} requests for the past 24 hours.`;
          break;
        }
        const at = clock();
        await recordRequest(source, at);
        requests = [...requests, { source, at: at.toISOString() }];
        try {
          const answer: SearchPage = await searchPostings(source, credentialsFor(config, source), search.query, next, requestContext(source));
          list.push(...answer.postings);
          fresh += (await newPostings(answer.postings)).length;
          next = answer.next;
        } catch (failure) {
          if (!(failure instanceof JobSearchError)) throw failure;
          error = failure.message;
          break;
        }
        if (!next || fresh >= settings.agentMaxScores) break;
      }
      lists.push(list);
      results.push({ searchId: search.id, searchName: agentSearchLabel(search), source, found: list.length, fresh, error });
    }
    lanes.push({ search, postings: mergePostings(lists), results });
  }
  return lanes;
}

/** Links candidates to the searches that found them (#11): new ones and ones kept before, but not dismissed ones. */
async function attribute(lanes: readonly Lane[]): Promise<void> {
  for (const { search, postings } of lanes) {
    if (postings.length === 0) continue;
    const candidates = await prisma.agentCandidate.findMany({
      where: {
        status: { not: AgentCandidateStatus.DISMISSED },
        OR: [{ dedupeKey: { in: postings.map(agentDedupeKey) } }, ...postings.map(({ source, externalId }) => ({ source, externalId }))],
      },
      select: { id: true },
    });
    await prisma.agentCandidateSearch.createMany({
      data: candidates.map((candidate) => ({ candidateId: candidate.id, searchId: search.id, searchName: agentSearchLabel(search) })),
      skipDuplicates: true,
    });
  }
}

/**
 * One run: every enabled saved search, on its sources, within each
 * source's budget; then a score for the new postings, taken from each
 * search in turn, up to agentMaxScores for the whole run. Each is kept as a
 * candidate, so it doesn't come back; one below agentMinScore stays out of
 * the queue. With auto-draft on, the best of them get a draft each, up to
 * agentMaxDrafts, each its own job. A scheduled run does nothing while the
 * agent is off.
 */
export async function runAgentScan({ manual }: { manual: boolean }, context: JobContext, now = new Date()): Promise<AgentScanResult> {
  // The time each request goes out, counted from `now`.
  const started = Date.now();
  const clock = () => new Date(now.getTime() + Date.now() - started);
  const settings = await loadSettings();
  if (!settings.agentEnabled && !manual) return stopped("The job agent is off.");
  const saved = await loadAgentSearches();
  const searches = saved.filter((search) => search.enabled && agentQueryReady(search.query));
  const setup = await agentSetupProblem(saved);
  if (setup) return stopped(setup);
  const config = await loadJobSearchConfig();
  const asked = [...new Set(searches.flatMap((search) => searchSources(search, usableSources(config).sources)))];
  const budget = budgetProblem(settings.agentRequests, settings.jobSourceBudgets, asked, now);
  // Startups need no requests from a source's budget.
  if (budget && !settings.agentStartups) return stopped(budget);

  const run = await recordRunStart(now, manual);
  let results: AgentRun["searches"] = [];
  const finish = async (result: AgentScanResult) => {
    await recordRunEnd(run, result.message, results);
    return result;
  };

  await context.step(searches.length === 1 ? "Searching for new postings" : `Running ${searches.length} searches`);
  const lanes = budget ? [] : await collect(searches, settings, context, clock);
  results = lanes.flatMap((lane) => lane.results);
  await attribute(lanes);
  const startups = await startupLane(settings, context, now);

  const found = new Set(lanes.flatMap((lane) => lane.postings.map(agentDedupeKey))).size + startups.length;
  const freshLanes: AgentPosting[][] = await Promise.all(lanes.map((lane) => newPostings(lane.postings)));
  const ordered = roundRobin([...freshLanes, startups]);
  const counts = { found, fresh: ordered.length, skipped: found - ordered.length, drafted: 0 };
  if (ordered.length === 0) {
    const failed = results.find((result) => result.error);
    return finish({
      ...counts,
      scored: 0,
      message: found === 0 ? (failed?.error ?? "The searches found no postings this time.") : "No new postings this time.",
    });
  }

  const toScore = ordered.slice(0, settings.agentMaxScores);
  await context.step(`Scoring ${toScore.length} ${toScore.length === 1 ? "posting" : "postings"}`);
  const [score, profile] = await Promise.all([loadPostingScorer(), loadProfile()]);
  let scored = 0;
  let queued = 0;
  const kept: string[] = [];
  let problem: string | null = null;
  for (const posting of toScore) {
    if (context.signal.aborted) break;
    try {
      const { data, scoredWith } = await score(posting, profile, context.signal);
      const candidate = await prisma.agentCandidate.create({ data: candidateData(posting, data, scoredWith), select: { id: true } });
      // Find jobs shows it too (#208); a startup isn't in Find jobs.
      if (isJobSource(posting.source)) await saveScore({ source: posting.source, externalId: posting.externalId }, data, scoredWith);
      kept.push(candidate.id);
      scored += 1;
      if (data.score >= settings.agentMinScore) queued += 1;
    } catch (error) {
      // Another run kept it first: it's seen either way.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      // One posting that fails doesn't stop the rest.
      if (error instanceof AiError) problem = error.message;
      else if (!context.signal.aborted) logServerError("job agent scoring", error);
    }
  }
  await attribute(lanes);

  // Auto-draft (#197, off by default): the best of this run's, one job each.
  let drafted = 0;
  if (settings.agentAutoDraft && settings.agentMaxDrafts > 0 && !context.signal.aborted) {
    const best = await prisma.agentCandidate.findMany({
      where: { id: { in: kept }, status: AgentCandidateStatus.SCORED, score: { gte: settings.agentMinScore } },
      orderBy: { score: "desc" },
      take: settings.agentMaxDrafts,
      select: { id: true },
    });
    for (const { id } of best) await startJob(agentDraftJob, { candidateId: id }, { key: draftJobKey(id) });
    drafted = best.length;
  }

  const waiting = `${queued} new ${queued === 1 ? "posting is" : "postings are"} waiting for a look.`;
  const message =
    scored === 0
      ? (problem ?? "No postings could be scored this time.")
      : queued === 0
        ? `Scored ${scored} new ${scored === 1 ? "posting" : "postings"}; none reached your minimum score of ${settings.agentMinScore}.`
        : drafted > 0
          ? `${waiting} Preparing ${drafted === 1 ? "a draft for the best one" : `drafts for the best ${drafted}`}.`
          : waiting;
  return finish({ ...counts, scored, drafted, message });
}
