import "server-only";
import { isAiConfigured, isAiUsable, loadAiSettingsView } from "@/lib/ai/config";
import { providerOption } from "@/lib/ai/provider-options";
import { APPLY_BOTS } from "@/lib/application-bots";
import { readyAgentSources } from "@/lib/agent/fanout";
import { googleConnection } from "@/lib/google/account";
import { loadJobSearchConfig, credentialsFor } from "@/lib/job-search/config";
import { loadProfile } from "@/lib/profile-data";
import { REQUIRED_BASICS } from "@/lib/profile";
import { loadSettings } from "@/lib/settings-data";
import { loadScoringConfig, jevKey } from "@/lib/scoring/config";
import { prisma } from "@/lib/prisma";
import { cloudRuntime } from "@/lib/runtime";
import { env } from "@/lib/env";
import type { SetupItem } from "./setup-status";

/** Configuration inspection only; never spends provider/search quota or returns credentials. */
export async function loadSetupStatus(): Promise<SetupItem[]> {
  const [settings, profile, ai, aiChosen, aiUsable, jobs, scoring, google] = await Promise.all([
    loadSettings(), loadProfile(), loadAiSettingsView(), isAiConfigured(), isAiUsable(), loadJobSearchConfig(), loadScoringConfig(), googleConnection(),
  ]);
  const missing = REQUIRED_BASICS.filter(field => !profile.basics[field].trim());
  const keyMissing = !providerOption(ai.provider).local && ["none", "unreadable"].includes(ai.keyState)
    && !(ai.provider === "OPENAI" && !ai.baseUrl.startsWith("https://api.openai.com"));
  const aiReady = aiChosen && aiUsable && !keyMissing;
  let jobsReady = false;
  if (jobs.source) { try { credentialsFor(jobs, jobs.source); jobsReady = true; } catch { /* Written as a configuration issue below. */ } }
  const scoreReady = scoring.scorer === "AI" ? aiReady : jevKey(scoring).problem === null;
  const driveReady = google.status === "connected" && google.canArchiveDrive && !settings.driveSyncProblem;
  const agentReady = settings.agentEnabled && readyAgentSources(jobs).length > 0 && scoreReady;
  const workerReady = !cloudRuntime() || Boolean(process.env.DATABASE_URL_UNPOOLED && process.env.HIREME_WORKER_VERCEL_TOKEN);
  let databaseReady = true;
  try { await prisma.$queryRaw`SELECT 1`; } catch { databaseReady = false; }
  const item = (id: string, title: string, ready: boolean, detail: string, href: string, required = true): SetupItem => ({ id, title, status: ready ? "ready" : required ? "attention" : "optional", detail, href, required, verification: "configuration" });
  const items: SetupItem[] = [
    { ...item("database", "Database", databaseReady, databaseReady ? "Live database check succeeded." : "The database could not be reached. Check server configuration.", "/settings?section=setup#server-configuration"), verification: "live" },
    item("profile", "Profile and contact details", missing.length === 0, missing.length ? `Complete these profile fields: ${missing.join(", ")}.` : "Required profile fields are filled in. Review experience and supporting facts in your profile.", "/profile"),
    item("ai", "AI provider and API access", aiReady, aiReady ? `${providerOption(ai.provider).name} and model are configured. Use Test connection in AI settings to verify access.` : "Choose a provider, model and any required API key. Unreadable or missing keys need attention.", "/settings?section=ai"),
    item("jobs", "Job search source", jobsReady, jobsReady ? `${jobs.source} is configured. Test it in Job search settings to check credentials and quota.` : settings.jobSource === "OFF" ? "Job search is switched off; manual postings still work." : "Choose a job source and complete its required credentials or acknowledgement.", "/settings?section=jobs", settings.jobSource !== "OFF"),
    item("scoring", "Job scoring", scoreReady, scoreReady ? `${scoring.scorer === "AI" ? "AI model" : "Jev"} scoring is configured.` : "Configure the selected scoring provider and its required key/model.", "/settings?section=scoring"),
    item("documents", "Document defaults", true, "Paper, language, theme and reference defaults are available. Review them before generating applications.", "/settings?section=documents"),
    item("bots", "Application bots and prompts", true, `Default: ${APPLY_BOTS.find(bot => bot.value === settings.applyBot)!.label}. Configure individual preferences and preview a real job’s prompt here. Clipboard handoff does not require MCP.`, "/settings?section=agent"),
    item("drive", "Google Drive auto-save", driveReady, !settings.driveAutoSave ? "Auto-save is switched off; ZIP packets remain available." : settings.driveSyncProblem || (driveReady ? "Drive access is granted. Application packets are saved in background jobs when their content changes." : "Connect Google Drive and grant per-file access to enable background packet saving."), "/settings?section=google", settings.driveAutoSave),
    item("agent", "Scheduled job agent", settings.agentEnabled && agentReady, !settings.agentEnabled ? "Optional. Enable the agent and configure its query, sources and schedule to discover jobs automatically." : agentReady ? "The enabled agent has a query or company list, a usable source and a scoring provider." : "The agent is enabled but its query/company list, job sources or scoring needs attention.", "/settings?section=agent", settings.agentEnabled),
    item("gmail", "Gmail and inbox", google.status === "connected" && google.canSend && google.canRead, "Optional. Grant Gmail permissions to send applications and check employer replies. These permissions are separate from Drive.", "/settings?section=google", false),
    item("calendar", "Calendar interviews", google.status === "connected" && google.canUseCalendar, "Optional. Grant Calendar access and review your calendar, time zone and working hours.", "/settings?section=google", false),
    item("connector", "MCP access for external bots", settings.connectorEnabledAt !== null, "Optional. Enable the connector, connect each bot, and review its permissions. A selected bot is not automatically an authorized client.", "/settings?section=connector", false),
    item("backups", "Backups and data export", settings.nightlyBackup, settings.backupProblem || (settings.nightlyBackup ? "Nightly backups are enabled. Check the latest backup and download an independent copy in Your data." : "Optional. Enable nightly backups or download an export."), "/settings?section=data", false),
    item("worker", "Background worker", workerReady, workerReady ? cloudRuntime() ? "Cloud worker connection settings are present. Background jobs wake the worker when needed; this is not a live worker connectivity test." : "This install runs background jobs locally." : "The cloud worker needs its direct database URL and scaling credential in server configuration. Review the deployment configuration.", "/settings?section=setup#server-configuration"),
    item("address", "Public address and OAuth callbacks", Boolean(env.HIREME_PUBLIC_URL) || !cloudRuntime(), "For a hosted install, set the public address and register the Google/MCP callback URLs shown in their settings pages.", "/settings?section=setup#server-configuration", cloudRuntime()),
  ];
  if (!settings.driveAutoSave) items.find(entry => entry.id === "drive")!.status = "disabled";
  if (!settings.agentEnabled) items.find(entry => entry.id === "agent")!.status = "disabled";
  if (settings.backupProblem) Object.assign(items.find(entry => entry.id === "backups")!, { status: "attention", detail: settings.backupProblem });
  if (google.status === "connected" && google.syncProblem) Object.assign(items.find(entry => entry.id === "gmail")!, { status: "attention", detail: google.syncProblem });
  return items;
}
