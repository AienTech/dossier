import "server-only";

import { AgentCandidateStatus, JobStatus } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/dates";
import { agentSources, loadJobSearchConfig } from "@/lib/job-search/config";
import { isJobSource, postedAgo, type JobSource } from "@/lib/job-search/search";
import type { PostingSource } from "@/generated/prisma/enums";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { criteriaChanged } from "@/lib/scoring/criteria";
import { startupEmailSchema } from "@/lib/startups/types";

import { stringsOf } from "./candidates";
import { AGENT_JOB_KEY } from "./jobs";
import { agentSetupProblem } from "./run";
import { budgetFreeAt, budgetOf, requestsLeft } from "./runs";
import { nextAgentRun } from "./schedule";
import { agentSearchLabel, loadAgentSearches, searchSources } from "./searches";

// What the Agent screen shows (E16-6).

export type AgentCandidateView = {
  id: string;
  title: string;
  company: string;
  /** "Rotterdam · Remote · €70k", what's known of them. */
  facts: string;
  /** "Posted 2 days ago · via LinkedIn on JSearch", or "From Startups, via Y Combinator". */
  origin: string;
  /** STARTUP for a startup from Startups (#222). */
  source: PostingSource;
  url: string;
  score: number;
  reasons: string[];
  redFlags: string[];
  /** Why the last try at a draft failed. */
  error: string | null;
  /** The draft, once there is one. */
  applicationId: string | null;
  /** The job preparing its draft, while one is queued or running. */
  draftJobId: string | null;
  /** The saved searches that found it, by name. */
  foundBy: string[];
  /** Scored before the scoring criteria last changed. */
  stale: boolean;
  /** A startup's addresses for applications (#222); empty for a posting. */
  emails: string[];
};

export type AgentView = {
  enabled: boolean;
  autoDraft: boolean;
  minScore: number;
  maxScores: number;
  maxDrafts: number;
  /** The enabled saved searches: "Data scientist · Berlin, 25 km", and the sources each asks. */
  searches: { id: string; label: string; sources: string }[];
  /** Why it can't run: no search, AI provider, source or key; null when it's set up. */
  setupProblem: string | null;
  /** Which settings section fixes it. */
  setupSection: "agent" | "ai" | "jobs" | null;
  /** Each source the searches ask: requests left of its budget (null is no limit), and when one comes back if none is left. */
  budgets: { source: JobSource; name: string; left: number | null; limit: number | null; freeAt: string | null }[];
  lastRun: {
    at: string;
    message: string | null;
    /** How each search did on each source. */
    searches: { label: string; source: string; found: number; fresh: number; error: string | null }[];
  } | null;
  /** In the user's zone; null while the agent is off. */
  nextRun: string | null;
  /** A run queued or running, to follow. */
  runJobId: string | null;
  drafts: AgentCandidateView[];
  /** At or above the minimum score, best first. */
  scored: AgentCandidateView[];
  /** Below it: kept so they don't come back, shown on request. */
  belowMinimum: AgentCandidateView[];
};

/** The Agent item's badge (E16-6): what's waiting for a look. */
export async function countAgentQueue(): Promise<number> {
  const { agentMinScore } = await loadSettings();
  return prisma.agentCandidate.count({
    where: {
      OR: [
        { status: AgentCandidateStatus.SCORED, score: { gte: agentMinScore } },
        { status: AgentCandidateStatus.DRAFTED, applicationId: { not: null } },
      ],
    },
  });
}

/** "Today" and "Yesterday" in a sentence; "2 days ago" or "15 Oct" as they are. */
const posted = (ago: string) => (ago === "Today" || ago === "Yesterday" ? ago.toLowerCase() : ago);

const sectionOf = (problem: string): AgentView["setupSection"] =>
  problem.includes("AI provider") ? "ai" : problem.includes("Job search") ? "jobs" : "agent";

export async function loadAgentView(now = new Date()): Promise<AgentView> {
  const [settings, config, timeZone, saved, candidates, draftJobs, runJobs] = await Promise.all([
    loadSettings(),
    loadJobSearchConfig(),
    lastKnownTimeZone(),
    loadAgentSearches(),
    prisma.agentCandidate.findMany({
      where: { status: { in: [AgentCandidateStatus.SCORED, AgentCandidateStatus.DRAFTING, AgentCandidateStatus.DRAFTED] } },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      include: { searches: { select: { searchName: true }, orderBy: { createdAt: "asc" } }, startup: { select: { emails: true } } },
    }),
    prisma.job.findMany({
      where: { type: "agent-draft", status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
      select: { id: true, key: true },
    }),
    prisma.job.findMany({ where: { key: AGENT_JOB_KEY, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { id: true }, take: 1 }),
  ]);
  const draftJob = new Map(draftJobs.map((job) => [job.key?.replace(/^agent-candidate:/, ""), job.id]));

  const sources = agentSources(config);
  const enabled = saved.filter((search) => search.enabled);
  const searches = enabled.map((search) => ({
    id: search.id,
    label: agentSearchLabel(search),
    sources: searchSources(search, sources).map((source) => SOURCE_INFO[source].name).join(", "),
  }));
  const asked = [...new Set(enabled.flatMap((search) => searchSources(search, sources)))];
  const budgets = asked.map((source) => {
    const freeAt = budgetFreeAt(settings.agentRequests, settings.jobSourceBudgets, source, now);
    return {
      source,
      name: SOURCE_INFO[source].name,
      left: requestsLeft(settings.agentRequests, settings.jobSourceBudgets, source, now),
      limit: budgetOf(settings.jobSourceBudgets, source),
      freeAt: freeAt ? formatDateTime(freeAt, timeZone, now) : null,
    };
  });
  const setupProblem = await agentSetupProblem(saved);

  const view = (candidate: (typeof candidates)[number]): AgentCandidateView => ({
    id: candidate.id,
    title: candidate.title.trim() || "Untitled posting",
    company: candidate.company.trim(),
    facts: [candidate.place, candidate.remote ? "Remote" : "", candidate.salary].filter(Boolean).join(" · "),
    origin: [
      candidate.postedAt ? `Posted ${posted(postedAgo(candidate.postedAt.toISOString(), now))}` : "",
      isJobSource(candidate.source)
        ? [candidate.via ? `via ${candidate.via}` : "", `on ${SOURCE_INFO[candidate.source].name}`].filter(Boolean).join(" ")
        : `From Startups${candidate.via ? `, via ${candidate.via}` : ""}`,
    ]
      .filter(Boolean)
      .join(" · "),
    source: candidate.source,
    url: candidate.url,
    score: candidate.score,
    reasons: stringsOf(candidate.reasons),
    redFlags: stringsOf(candidate.redFlags),
    error: candidate.error,
    applicationId: candidate.applicationId,
    draftJobId: draftJob.get(candidate.id) ?? null,
    foundBy: [...new Set(candidate.searches.map((link) => link.searchName))],
    // One scored before any tag was kept counts as made without criteria.
    stale: criteriaChanged(candidate.scoredWith, settings.scoringCriteria),
    emails: startupEmailSchema
      .array()
      .catch([])
      .parse(candidate.startup?.emails ?? [])
      .filter((entry) => entry.label !== "Person")
      .map((entry) => entry.email),
  });
  const drafts = candidates.filter((candidate) => candidate.status === AgentCandidateStatus.DRAFTED && candidate.applicationId).map(view);
  const waiting = candidates.filter((candidate) => candidate.status !== AgentCandidateStatus.DRAFTED);
  const last = settings.agentRuns[0];

  return {
    enabled: settings.agentEnabled,
    autoDraft: settings.agentAutoDraft,
    minScore: settings.agentMinScore,
    maxScores: settings.agentMaxScores,
    maxDrafts: settings.agentMaxDrafts,
    searches,
    setupProblem,
    setupSection: setupProblem ? sectionOf(setupProblem) : null,
    budgets,
    lastRun: last
      ? {
          at: formatDateTime(new Date(last.at), timeZone, now),
          message: last.message,
          searches: last.searches.map((entry) => ({ label: entry.searchName, source: SOURCE_INFO[entry.source].name, found: entry.found, fresh: entry.fresh, error: entry.error })),
        }
      : null,
    nextRun: settings.agentEnabled ? formatDateTime(nextAgentRun(now, settings.agentHour, timeZone, settings.agentRuns), timeZone, now) : null,
    runJobId: runJobs[0]?.id ?? null,
    drafts,
    scored: waiting.filter((candidate) => candidate.score >= settings.agentMinScore).map(view),
    belowMinimum: waiting.filter((candidate) => candidate.score < settings.agentMinScore).map(view),
  };
}
