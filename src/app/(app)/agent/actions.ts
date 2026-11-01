"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { agentDraftJob, approveCandidate, dismissCandidate, draftJobKey, restoreCandidate } from "@/lib/agent/draft";
import { AGENT_JOB_KEY, agentScanJob } from "@/lib/agent/jobs";
import { agentSetupProblem } from "@/lib/agent/run";
import { budgetProblem } from "@/lib/agent/runs";
import { agentQueryReady, agentSearchInputSchema, loadAgentSearches, searchSources } from "@/lib/agent/searches";
import { action, ActionError } from "@/lib/action";
import { agentSources, loadJobSearchConfig } from "@/lib/job-search/config";
import { safeLink } from "@/lib/job-search/search";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// The Agent screen's actions (E16). Nothing here ever sends anything:
// approving only makes a draft a normal Draft application.

const budget = z.number().int().min(0).max(100).nullable();

/**
 * Settings → Job agent (E16-7): each change saves at once. Turning the agent
 * on needs a search with keywords and a country.
 */
export const saveAgentSettings = action(
  z.object({
    enabled: z.boolean().optional(),
    hour: z.number().int().min(0).max(23).optional(),
    minScore: z.number().int().min(0).max(100).optional(),
    maxScores: z.number().int().min(1).max(30).optional(),
    maxDrafts: z.number().int().min(0).max(10).optional(),
    autoDraft: z.boolean().optional(),
    maxSearches: z.number().int().min(1).max(10).optional(),
    maxPages: z.number().int().min(1).max(5).optional(),
    startups: z.boolean().optional(),
    startupMinMatch: z.number().int().min(0).max(100).optional(),
    budgets: z.object({ JSEARCH: budget, ADZUNA: budget, FREEHIRE: budget }).optional(),
  }),
  async (changes) => {
    const startups = changes.startups ?? (await loadSettings()).agentStartups;
    if (changes.enabled && !startups && !(await loadAgentSearches()).some((search) => search.enabled && agentQueryReady(search.query))) {
      throw new ActionError("Add a search with what to look for and a country before turning the agent on.");
    }
    if (changes.maxSearches !== undefined && (await prisma.agentSearch.count()) > changes.maxSearches) {
      throw new ActionError("Delete searches first: there are more than that.");
    }
    await saveSettings({
      agentEnabled: changes.enabled,
      agentHour: changes.hour,
      agentMinScore: changes.minScore,
      agentMaxScores: changes.maxScores,
      agentMaxDrafts: changes.maxDrafts,
      agentAutoDraft: changes.autoDraft,
      agentMaxSearches: changes.maxSearches,
      agentMaxPages: changes.maxPages,
      agentStartups: changes.startups,
      agentStartupMinMatch: changes.startupMinMatch,
      jobSourceBudgets: changes.budgets,
    });
    revalidatePath("/agent");
    return null;
  },
);

const searchId = z.string().min(1).max(100);

/** Adds a saved search, or changes one (`id`); at most agentMaxSearches. Returns the searches as they are now. */
export const saveAgentSearch = action(agentSearchInputSchema.extend({ id: searchId.optional() }), async ({ id, ...search }) => {
  if (search.enabled && !agentQueryReady(search.query)) {
    throw new ActionError(search.query.keywords.trim() ? "Choose a country for the search." : "Type what the search should look for.");
  }
  const data = { name: search.name, query: search.query, sources: search.sources, enabled: search.enabled };
  if (id) {
    const { count } = await prisma.agentSearch.updateMany({ where: { id }, data });
    if (count === 0) throw new ActionError("That search no longer exists. Reload the page.");
  } else {
    const [{ agentMaxSearches }, count, last] = await Promise.all([
      loadSettings(),
      prisma.agentSearch.count(),
      prisma.agentSearch.findFirst({ orderBy: { sort: "desc" }, select: { sort: true } }),
    ]);
    if (count >= agentMaxSearches) throw new ActionError(`Keep at most ${agentMaxSearches} searches, or raise the limit below.`);
    await prisma.agentSearch.create({ data: { ...data, sort: (last?.sort ?? -1) + 1 } });
  }
  revalidatePath("/agent");
  return loadAgentSearches();
});

/** Deletes a saved search. The candidates it found keep its name. */
export const deleteAgentSearch = action(z.object({ id: searchId }), async ({ id }) => {
  await prisma.agentSearch.deleteMany({ where: { id } });
  revalidatePath("/agent");
  return loadAgentSearches();
});

/** Moves a saved search one place up or down; the first ones get the first turn when scoring. */
export const moveAgentSearch = action(z.object({ id: searchId, by: z.union([z.literal(-1), z.literal(1)]) }), async ({ id, by }) => {
  const searches = await loadAgentSearches();
  const from = searches.findIndex((search) => search.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= searches.length) return searches;
  const order = searches.map((search) => search.id);
  [order[from], order[to]] = [order[to], order[from]];
  await prisma.$transaction(order.map((entry, sort) => prisma.agentSearch.update({ where: { id: entry }, data: { sort } })));
  revalidatePath("/agent");
  return loadAgentSearches();
});

/**
 * Run now (E16-4): one more run, as long as some source the searches ask
 * has requests left. A run already queued or running is reused rather than
 * started again.
 */
export const runAgentNow = action(z.object({}), async () => {
  const settings = await loadSettings();
  if (!settings.agentEnabled) throw new ActionError("Turn the job agent on in Settings → Job agent first.");
  const searches = await loadAgentSearches();
  const setup = await agentSetupProblem(searches);
  if (setup) throw new ActionError(setup);
  const [unfinished] = await findUnfinishedJobs(AGENT_JOB_KEY);
  if (unfinished) return { jobId: unfinished.id, reused: true };
  const sources = agentSources(await loadJobSearchConfig());
  const asked = [...new Set(searches.filter((search) => search.enabled).flatMap((search) => searchSources(search, sources)))];
  const limit = budgetProblem(settings.agentRequests, settings.jobSourceBudgets, asked, new Date());
  if (limit) throw new ActionError(limit);
  const jobId = await startJob(agentScanJob, { manual: true }, { key: AGENT_JOB_KEY });
  revalidatePath("/agent");
  return { jobId, reused: false };
});

const candidateId = z.string().min(1).max(100);

/** Every screen an agent draft shows on, or leaves. */
function revalidateAgent() {
  revalidatePath("/agent");
  revalidatePath("/applications");
  revalidatePath("/jobs");
  revalidatePath("/");
}

/**
 * Prepare draft (E16-5): writes a candidate's draft in the background. A
 * draft under way is reused, and one already made is answered with.
 */
export const prepareAgentDraft = action(z.object({ candidateId }), async ({ candidateId }) => {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id: candidateId }, select: { status: true, applicationId: true } });
  if (!candidate) throw new ActionError("That posting is no longer in the agent's queue.");
  if (candidate.status === AgentCandidateStatus.DRAFTED && candidate.applicationId) return { jobId: null, applicationId: candidate.applicationId };
  const [unfinished] = await findUnfinishedJobs(draftJobKey(candidateId));
  if (unfinished) return { jobId: unfinished.id, applicationId: null };
  if (candidate.status !== AgentCandidateStatus.SCORED) throw new ActionError("That posting is no longer waiting for a draft.");
  const jobId = await startJob(agentDraftJob, { candidateId }, { key: draftJobKey(candidateId) });
  revalidatePath("/agent");
  return { jobId, applicationId: null };
});

/** Approve (E16-5): the draft joins Applications as a Draft. Nothing is sent. */
export const approveAgentDraft = action(z.object({ candidateId }), async ({ candidateId }, { toast }) => {
  const applicationId = await approveCandidate(candidateId);
  revalidateAgent();
  toast("Added to Applications as a draft. Nothing has been sent.");
  return { applicationId };
});

/**
 * Dismiss (E16-5): the posting never comes back; its draft, if any, is
 * deleted. A posting dismissed before it had a draft can be put back.
 */
export const dismissAgentCandidate = action(z.object({ candidateId }), async ({ candidateId }) => {
  const { undo } = await dismissCandidate(candidateId);
  revalidateAgent();
  return { undo };
});

/** Undo on a dismissed posting's toast. */
export const restoreAgentCandidate = action(
  z.object({
    id: candidateId,
    place: z.string().max(500),
    remote: z.boolean().nullable(),
    salary: z.string().max(500),
    postedAt: z.coerce.date().nullable(),
    // Shown as a link again: only a web address.
    url: z.string().max(4000).transform(safeLink),
    via: z.string().max(500),
    description: z.string().max(200_000),
    complete: z.boolean(),
    reasons: z.array(z.string().max(500)).max(10).nullable(),
    redFlags: z.array(z.string().max(500)).max(10).nullable(),
  }),
  async (saved) => {
    await restoreCandidate(saved);
    revalidateAgent();
    return null;
  },
);
