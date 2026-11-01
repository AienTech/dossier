import "server-only";

import type { JobSource } from "@/lib/job-search/search";
import { AGENT_RUNS_KEPT, type AgentRequest, type AgentRun, type JobSourceBudgets } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// The job agent's runs and the requests they send (E16), kept in Settings
// rather than as Job rows, which the task-data sweep deletes after "Keep
// task data for": the budgets below must hold whatever that is set to.
// Each source has its own budget of requests in any 24 hours (Settings →
// Job agent), so a run spends what its sources allow and no more.

const DAY_MS = 24 * 60 * 60 * 1000;

/** A source's budget; null is no limit. The Bundesagentur für Arbeit is never asked, so it has none. */
export const budgetOf = (budgets: JobSourceBudgets, source: JobSource): number | null => (source === "ARBEITSAGENTUR" ? 0 : budgets[source]);

/** The requests to `source` in the 24 hours before `now`. */
const recentTo = (requests: readonly AgentRequest[], source: JobSource, now: Date) =>
  requests.filter((request) => request.source === source && now.getTime() - Date.parse(request.at) < DAY_MS);

/** How many more requests `source` may get now; null is no limit. */
export function requestsLeft(requests: readonly AgentRequest[], budgets: JobSourceBudgets, source: JobSource, now: Date): number | null {
  const budget = budgetOf(budgets, source);
  return budget === null ? null : Math.max(0, budget - recentTo(requests, source, now).length);
}

/** When `source` gets a request back, or null when it has one now. */
export function budgetFreeAt(requests: readonly AgentRequest[], budgets: JobSourceBudgets, source: JobSource, now: Date): Date | null {
  const budget = budgetOf(budgets, source);
  if (budget === null) return null;
  const recent = recentTo(requests, source, now).map((request) => Date.parse(request.at)).toSorted((a, b) => a - b);
  if (recent.length < budget) return null;
  // The oldest that has to drop out of the window.
  return new Date(recent[recent.length - budget] + DAY_MS);
}

/** "Try again in 25 minutes." */
export function waitText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  const hours = Math.round(minutes / 60);
  return `Try again in ${hours} ${hours === 1 ? "hour" : "hours"}.`;
}

/**
 * Why no run may start now, or null: when every source the searches ask has
 * used its budget, it says when the first one frees up.
 */
export function budgetProblem(requests: readonly AgentRequest[], budgets: JobSourceBudgets, sources: readonly JobSource[], now: Date): string | null {
  if (sources.length === 0) return null;
  const frees = sources.map((source) => budgetFreeAt(requests, budgets, source, now));
  if (frees.some((at) => at === null)) return null;
  const first = Math.min(...frees.map((at) => at!.getTime()));
  return `Every job source has used its requests for the past 24 hours. ${waitText(first - now.getTime())}`;
}

/** Records a request before it's sent, so a crash and a retry can't spend the budget twice. Older ones than a day drop out. */
export async function recordRequest(source: JobSource, now: Date): Promise<void> {
  const { agentRequests } = await loadSettings();
  const kept = agentRequests.filter((request) => now.getTime() - Date.parse(request.at) < DAY_MS);
  await saveSettings({ agentRequests: [...kept, { source, at: now.toISOString() }] });
}

/** Records a run as it starts. */
export async function recordRunStart(now: Date, manual: boolean): Promise<AgentRun> {
  const run: AgentRun = { at: now.toISOString(), manual, message: null, searches: [] };
  const { agentRuns } = await loadSettings();
  await saveSettings({ agentRuns: [run, ...agentRuns].slice(0, AGENT_RUNS_KEPT) });
  return run;
}

/** Notes what a run ended with, and how each search did, for the Agent screen. */
export async function recordRunEnd(run: AgentRun, message: string, searches: AgentRun["searches"] = []): Promise<void> {
  const { agentRuns } = await loadSettings();
  await saveSettings({ agentRuns: agentRuns.map((entry) => (entry.at === run.at ? { ...entry, message, searches } : entry)) });
}
