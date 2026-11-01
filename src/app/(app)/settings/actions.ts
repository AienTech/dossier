"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { AiProvider, Creativity, DateFormat, JobStatus, PaperSize, Tone } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { AiError, createProvider } from "@/lib/ai";
import { applyApiKeyChange } from "@/lib/ai/api-key";
import { keyStateOf, loadAiConfig, loadAiProfileConfig, loadAiSettingsView, resolveAiConfig } from "@/lib/ai/config";
import type { KeyState } from "@/lib/ai/provider-options";
import { DOCUMENT_LANGUAGES } from "@/lib/document-language";
import { deleteAllBackups } from "@/lib/backups";
import { env } from "@/lib/env";
import { JobSearchError, testSource } from "@/lib/job-search";
import { credentialsFor, jobSearchView, loadJobSearchConfig, requestContext, resolveJobSearchConfig } from "@/lib/job-search/config";
import { JOB_SOURCES, JSEARCH_HOSTS } from "@/lib/job-search/search";
import { cancelJob, startJob } from "@/lib/jobs/runner";
import { checkForUpdate } from "@/lib/update-check";
import { redirectProblem } from "@/lib/connector/oauth";
import { countTailoredDocuments, deleteAllDownloads, zipPdfsJob } from "@/lib/jobs/zip-pdfs";
import { disconnectGoogle } from "@/lib/google/account";
import { prisma } from "@/lib/prisma";
import { jevKey, loadScoringConfig, scoringView } from "@/lib/scoring/config";
import { MAX_CRITERIA, scoringCriterionSchema } from "@/lib/scoring/criteria";
import { SCORERS } from "@/lib/scoring/scorers";
import { askJev } from "@/lib/scoring/typesafe";
import { applySecretChange, JOB_SOURCE_KEY, TYPESAFE_KEY } from "@/lib/secrets";

import { seedBuiltIns } from "../../../../prisma/seed/built-ins";
import { isJobRetention, settingsFromRows } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// Settings → AI provider (E6-3). Providers are saved as profiles; every
// field saves on its own, so a test or a model list always reflects what's
// saved. Before any profile exists, the first save makes one from what
// DOSSIER_AI_* sets.

const profileId = z.string().min(1).max(100).nullable();

/** The key state of a profile after a change, for the settings screen. */
async function profileKeyState(id: string): Promise<KeyState> {
  const profile = await prisma.aiProfile.findUniqueOrThrow({ where: { id } });
  return keyStateOf(profile, resolveAiConfig(profile, env));
}

async function nextProfileSort(): Promise<number> {
  const last = await prisma.aiProfile.findFirst({ orderBy: { sort: "desc" }, select: { sort: true } });
  return (last?.sort ?? -1) + 1;
}

/** The profile to change, made when it doesn't exist yet; the first one becomes the default. */
async function profileToChange(id: string | null, provider: AiProvider): Promise<{ id: string; provider: AiProvider; apiKeyEnc: string | null }> {
  if (id) {
    const found = await prisma.aiProfile.findUnique({ where: { id } });
    if (!found) throw new ActionError("That AI profile no longer exists. Reload the page.");
    return found;
  }
  const config = await loadAiConfig();
  const same = provider === config.provider;
  const created = await prisma.aiProfile.create({
    data: { provider, baseUrl: same ? config.baseUrl : null, model: same ? config.model : null, sort: await nextProfileSort() },
  });
  if (!(await loadSettings()).aiDefaultProfileId) await saveSettings({ aiDefaultProfileId: created.id });
  return created;
}

/**
 * Saves a profile's provider, server address and model (SET-1). A key
 * belongs to its provider: switching provider removes it, so it's never
 * sent to another company's server.
 */
export const saveAiProvider = action(
  z.object({
    profileId,
    provider: z.enum(AiProvider),
    // Saved as typed: a half-typed address is harmless, and the connection test explains a wrong one.
    baseUrl: z.string().trim().max(500),
    model: z.string().trim().max(200),
  }),
  async ({ profileId: id, provider, baseUrl, model }) => {
    const current = await profileToChange(id, provider);
    await prisma.aiProfile.update({
      where: { id: current.id },
      data: { provider, baseUrl: baseUrl || null, model: model || null, ...(current.provider !== provider ? { apiKeyEnc: null } : {}) },
    });
    return { id: current.id, keyState: await profileKeyState(current.id) };
  },
);

/** Saves a profile's new API key, encrypted (E6-2), or removes it. The key never comes back to the browser. */
export const saveApiKey = action(
  z.object({
    profileId,
    provider: z.enum(AiProvider),
    change: z.discriminatedUnion("action", [
      z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
      z.object({ action: z.literal("clear") }),
    ]),
  }),
  async ({ profileId: id, provider, change }) => {
    const current = await profileToChange(id, provider);
    await prisma.aiProfile.update({ where: { id: current.id }, data: { apiKeyEnc: applyApiKeyChange(current.apiKeyEnc, change) } });
    return { id: current.id, keyState: await profileKeyState(current.id) };
  },
);

/** Renames a profile; empty shows its provider and model instead. */
export const saveAiProfileName = action(z.object({ profileId: z.string().min(1), name: z.string().trim().max(80) }), async ({ profileId: id, name }) => {
  await prisma.aiProfile.updateMany({ where: { id }, data: { name } });
});

/** Adds a profile, a local model until another provider is picked. The setup from DOSSIER_AI_* is saved first. */
export const addAiProfile = action(z.object({}), async () => {
  if ((await prisma.aiProfile.count()) === 0) await profileToChange(null, (await loadAiConfig()).provider);
  const created = await prisma.aiProfile.create({ data: { provider: AiProvider.LOCAL, sort: await nextProfileSort() } });
  return { id: created.id, view: await loadAiSettingsView() };
});

/** Deletes a profile. Tasks that used it go back to the default; the default moves to the first one left. */
export const deleteAiProfile = action(z.object({ profileId: z.string().min(1) }), async ({ profileId: id }) => {
  await prisma.$transaction(async (tx) => {
    await tx.aiProfile.deleteMany({ where: { id } });
    const settings = settingsFromRows(await tx.setting.findMany());
    const first = await tx.aiProfile.findFirst({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true } });
    const tasks = Object.fromEntries(Object.entries(settings.aiTaskProfiles).filter(([, value]) => value !== id));
    await saveSettings({ aiTaskProfiles: tasks, ...(settings.aiDefaultProfileId === id ? { aiDefaultProfileId: first?.id ?? null } : {}) }, tx);
  });
  return loadAiSettingsView();
});

/** The profile tasks use unless one is chosen for them. */
export const setDefaultAiProfile = action(z.object({ profileId: z.string().min(1) }), async ({ profileId: id }) => {
  if (!(await prisma.aiProfile.findUnique({ where: { id }, select: { id: true } }))) throw new ActionError("That AI profile no longer exists. Reload the page.");
  await saveSettings({ aiDefaultProfileId: id });
  return loadAiSettingsView();
});

/** Which profile scoring and writing use; null means the default. */
export const saveAiTaskProfiles = action(z.object({ scoring: profileId, writing: profileId }), async ({ scoring, writing }) => {
  const ids = new Set((await prisma.aiProfile.findMany({ select: { id: true } })).map((profile) => profile.id));
  const pick = (id: string | null) => (id && ids.has(id) ? id : undefined);
  await saveSettings({ aiTaskProfiles: { scoring: pick(scoring), writing: pick(writing) } });
  return loadAiSettingsView();
});

/** The models a profile's server offers, for the model select. */
export const listAiModels = action(z.object({ profileId }), async ({ profileId: id }) => {
  try {
    const provider = createProvider(await loadAiProfileConfig(id));
    return { models: await provider.listModels(AbortSignal.timeout(15_000)), problem: null };
  } catch (error) {
    if (error instanceof AiError) return { models: [], problem: error.message };
    throw error;
  }
});

/** A test connection on a stop-watch has no business waiting minutes. */
const TEST_TIMEOUT_MS = 60_000;

/** "Test connection" (SET-2): a short prompt to a profile's provider, timed. */
export const testAiConnection = action(z.object({ profileId }), async ({ profileId: id }) => {
  try {
    const config = await loadAiProfileConfig(id);
    const provider = createProvider({ ...config, timeoutMs: Math.min(config.timeoutMs, TEST_TIMEOUT_MS) });
    const { model, latencyMs } = await provider.test();
    return { connected: true as const, model, seconds: Math.round(latencyMs / 100) / 10 };
  } catch (error) {
    if (error instanceof AiError) return { connected: false as const, message: error.message };
    throw error;
  }
});

// Settings → Job search (E14-4). Every field saves on its own; each returns
// what the section shows, never a key.

const loadView = async () => jobSearchView(await loadJobSearchConfig());

/**
 * Turns a source on or off for searching; with none on, job search is off.
 * The Bundesagentur für Arbeit only with its note accepted, now
 * (`accepted`) or before, and only while the server offers it (#223).
 */
export const saveJobSource = action(
  z.object({ source: z.enum(JOB_SOURCES), on: z.boolean(), accepted: z.literal(true).optional() }),
  async ({ source, on, accepted }) => {
    const config = await loadJobSearchConfig();
    const accepting = source === "ARBEITSAGENTUR" && accepted === true;
    if (source === "ARBEITSAGENTUR" && on) {
      if (!config.arbeitsagentur.offered) throw new ActionError("The Bundesagentur für Arbeit isn't offered on this server.");
      if (!accepting && !config.arbeitsagentur.acceptedAt) throw new ActionError("Tick “I understand” under the note about the Bundesagentur für Arbeit first.");
    }
    const chosen = new Set(config.sources);
    if (on) chosen.add(source);
    else chosen.delete(source);
    await saveSettings({
      jobSources: JOB_SOURCES.filter((entry) => chosen.has(entry)),
      ...(accepting ? { arbeitsagenturAcceptedAt: new Date().toISOString() } : {}),
    });
    return loadView();
  },
);

/** Saves where the JSearch key is from, or the Adzuna app ID, which isn't a secret. */
export const saveJobSearchDetails = action(
  z.strictObject({ jsearchHost: z.enum(JSEARCH_HOSTS).optional(), adzunaAppId: z.string().trim().max(200).optional() }),
  async ({ jsearchHost, adzunaAppId }) => {
    await saveSettings({ jsearchHost, ...(adzunaAppId === undefined ? {} : { adzunaAppId: adzunaAppId || null }) });
    return loadView();
  },
);

/** Saves a source's key (JSearch's per host), encrypted for job sources only, or removes it. The key never comes back to the browser. */
export const saveJobSourceKey = action(
  z.object({
    source: z.enum(["JSEARCH", "ADZUNA"]),
    host: z.enum(JSEARCH_HOSTS).optional(),
    change: z.discriminatedUnion("action", [
      z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
      z.object({ action: z.literal("clear") }),
    ]),
  }),
  async ({ source, host, change }) => {
    const field = source === "ADZUNA" ? "adzunaKeyEnc" : host === "rapidapi" ? "jsearchRapidapiKeyEnc" : "jsearchKeyEnc";
    const current = await loadSettings();
    await saveSettings({ [field]: applySecretChange(JOB_SOURCE_KEY, current[field], change) });
    return loadView();
  },
);

/** "Test connection": the smallest request a source takes, timed; JSearch with one host's key when `host` is given. */
export const testJobSource = action(z.object({ source: z.enum(JOB_SOURCES), host: z.enum(JSEARCH_HOSTS).optional() }), async ({ source, host }) => {
  const config = await loadJobSearchConfig();
  const started = performance.now();
  try {
    if (source === "JSEARCH" && host) {
      const only = resolveJobSearchConfig({ ...(await loadSettings()), jsearchHost: host }, env).jsearch;
      if (only.host !== host || !only.key) throw new JobSearchError("no-key", `Add your JSearch key for ${host === "rapidapi" ? "RapidAPI" : "OpenWeb Ninja"} first.`);
      await testSource("JSEARCH", { key: only.key, host }, requestContext("JSEARCH"));
    } else await testSource(source, credentialsFor(config, source), requestContext(source));
    return { connected: true as const, seconds: Math.round((performance.now() - started) / 100) / 10 };
  } catch (error) {
    if (error instanceof JobSearchError) return { connected: false as const, message: error.message };
    throw error;
  }
});

// Settings → Scoring (#274). Each returns what the section shows, never the key.

const loadScoringView = async () => scoringView(await loadScoringConfig());

/** What the user wants from a job, weighed by both scorers; returns the list as saved. */
export const saveScoringCriteria = action(z.object({ criteria: z.array(scoringCriterionSchema).max(MAX_CRITERIA) }), async ({ criteria }) => {
  await saveSettings({ scoringCriteria: criteria });
  return criteria;
});

/** What scores postings: the AI model, or Jev. */
export const saveScorer = action(z.object({ scorer: z.enum(SCORERS) }), async ({ scorer }) => {
  await saveSettings({ scorer });
  return loadScoringView();
});

/** Saves the TypeSafe key, encrypted for it only, or removes it. */
export const saveTypesafeKey = action(
  z.object({
    change: z.discriminatedUnion("action", [
      z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
      z.object({ action: z.literal("clear") }),
    ]),
  }),
  async ({ change }) => {
    const current = await loadSettings();
    await saveSettings({ typesafeKeyEnc: applySecretChange(TYPESAFE_KEY, current.typesafeKeyEnc, change) });
    return loadScoringView();
  },
);

/** "Test connection": one yes-or-no question to Jev about a sentence, timed. It costs a few dozen tokens. */
export const testJev = action(z.object({}), async () => {
  const jev = jevKey(await loadScoringConfig());
  if (jev.problem !== null) return { connected: false as const, message: jev.problem };
  const started = performance.now();
  try {
    const { model } = await askJev(
      { state: "Dossier is checking that it can reach Jev.", questions: { check: { type: "noul", instructions: "Is this text about checking a connection?" } } },
      { key: jev.key, timeoutMs: TEST_TIMEOUT_MS, retryDelaysMs: [] },
    );
    return { connected: true as const, model, seconds: Math.round((performance.now() - started) / 100) / 10 };
  } catch (error) {
    if (error instanceof AiError) return { connected: false as const, message: error.message };
    throw error;
  }
});

/**
 * Saves the settings that are a plain choice or switch, each as it changes
 * (E10-2, E10-3). Only the fields given are touched.
 */
export const updateSettings = action(
  z.strictObject({
    creativity: z.enum(Creativity).optional(),
    strict: z.boolean().optional(),
    showDiff: z.boolean().optional(),
    paper: z.enum(PaperSize).optional(),
    dateFormat: z.enum(DateFormat).optional(),
    defaultTone: z.enum(Tone).optional(),
    /** A language name, or null for the posting's language. */
    docLanguage: z.string().trim().min(1).max(60).nullable().optional(),
    /** One of the built-in languages, or null for English. */
    resumeLanguage: z
      .string()
      .refine((name) => DOCUMENT_LANGUAGES.some((language) => language.name === name), "Pick a language from the list.")
      .nullable()
      .optional(),
    fileNamePattern: z.string().max(200).optional(),
    includeRefs: z.boolean().optional(),
    pageLimit: z.enum(["1", "2", "none"]).optional(),
    nightlyBackup: z.boolean().optional(),
    jobRetentionHours: z.number().refine(isJobRetention).optional(),
    updateCheck: z.boolean().optional(),
  }),
  async (changes) => {
    await saveSettings(changes);
    return null;
  },
);

/**
 * "Other language…" (SET-7): adds a language to the list and writes
 * documents in it. A name already in the list, in any case, is just picked.
 */
export const addDocumentLanguage = action(
  z.object({ name: z.string().trim().min(1, "Type a language first.").max(60) }),
  async ({ name }) => {
    const { customLanguages } = await loadSettings();
    const known = [...DOCUMENT_LANGUAGES.map((language) => language.name), ...customLanguages];
    const existing = known.find((language) => language.toLocaleLowerCase() === name.toLocaleLowerCase());
    await saveSettings({ docLanguage: existing ?? name, ...(existing ? {} : { customLanguages: [...customLanguages, name] }) });
    return { language: existing ?? name, added: !existing };
  },
);

/** "Download all PDFs" (E10-5): zips every tailored document in the background. */
export const startZippingPdfs = action(z.object({}), async () => {
  const documents = await countTailoredDocuments();
  if (documents === 0) throw new ActionError("There are no tailored documents to download yet.");
  return { jobId: await startJob(zipPdfsJob, {}), documents };
});

/**
 * "Delete for good" (E10-8, SET-11): removes the profile, every application
 * with its documents, custom themes, settings, background jobs and the
 * backup and download files, then puts back what a new install has. The
 * session stays; the user lands on the empty dashboard.
 */
export const deleteEverything = action(z.object({ confirm: z.literal("DELETE") }), async () => {
  const unfinished = await prisma.job.findMany({ where: { status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { id: true } });
  for (const job of unfinished) await cancelJob(job.id);
  // Revokes Dossier's access at Google too (E15-1).
  await disconnectGoogle().catch(() => {});

  await prisma.$transaction(async (tx) => {
    await tx.job.deleteMany();
    // Find jobs' postings and past searches (E14-9, E14-10).
    await tx.posting.deleteMany();
    await tx.postingSearch.deleteMany();
    // Postings pasted for Claude chat (#221); the connector goes off with the settings.
    await tx.claudePaste.deleteMany();
    // What the job agent found, and its saved searches (E16).
    await tx.agentCandidate.deleteMany();
    await tx.agentSearch.deleteMany();
    await tx.postingScore.deleteMany();
    // Startups, and the fingerprints of ones removed for good (#222).
    await tx.startup.deleteMany();
    await tx.startupBlock.deleteMany();
    // Mail fetched from Gmail (E15-3).
    await tx.emailMessage.deleteMany();
    // Applications take their history, documents, chat and notes along.
    await tx.application.deleteMany();
    await tx.experience.deleteMany();
    await tx.project.deleteMany();
    await tx.skill.deleteMany();
    await tx.language.deleteMany();
    await tx.education.deleteMany();
    await tx.publication.deleteMany();
    await tx.reference.deleteMany();
    await tx.fact.deleteMany();
    await tx.profileField.deleteMany();
    await tx.theme.deleteMany({ where: { builtIn: false } });
    await tx.aiProfile.deleteMany();
    await tx.setting.deleteMany();
  });
  // An empty profile and default settings need no rows; the built-in themes do.
  await seedBuiltIns(prisma);
  await Promise.all([deleteAllBackups(), deleteAllDownloads()]);

  revalidatePath("/", "layout");
  redirect("/");
});

/** "Check for updates" (E10-9): the latest release, asked for now, and kept for the sidebar's notice. */
export const checkUpdates = action(z.object({}), async () => {
  const result = await checkForUpdate();
  revalidatePath("/", "layout");
  return result.status === "newer" ? result : { status: result.status };
});

// Settings → MCP connector (#221, #281). Every connector token carries
// connectorEnabledAt, so a new value signs every app out.

/** Turns the MCP connector on, or off, which closes its addresses and signs every app out. */
export const setConnector = action(z.object({ on: z.boolean() }), async ({ on }) => {
  await saveSettings({ connectorEnabledAt: on ? new Date().toISOString() : null });
  return { on };
});

/** "Disconnect all apps": the connector stays on, but Claude and every other app have to connect again. */
export const disconnectApps = action(z.object({}), async (_input, { toast }) => {
  if (!(await loadSettings()).connectorEnabledAt) throw new ActionError("The MCP connector is off already.");
  await saveSettings({ connectorEnabledAt: new Date().toISOString() });
  toast("Every app is disconnected. Connect again from an app to use Dossier there.");
  return null;
});

const MAX_REDIRECTS = 10;

/** Lets another MCP app sign in, by the address it comes back to (#281). */
export const addConnectorRedirect = action(
  z.object({ uri: z.string().trim().min(1, "Paste the app's callback address first.").max(2000) }),
  async ({ uri }) => {
    const problem = redirectProblem(uri);
    if (problem) throw new ActionError(problem);
    const { connectorRedirects } = await loadSettings();
    if (connectorRedirects.includes(uri)) return { redirects: connectorRedirects };
    if (connectorRedirects.length >= MAX_REDIRECTS) throw new ActionError(`That's ${MAX_REDIRECTS} apps already. Remove one first.`);
    const redirects = [...connectorRedirects, uri];
    await saveSettings({ connectorRedirects: redirects });
    return { redirects };
  },
);

/** Stops an app signing in again by that address. One signed in already keeps its tokens until Disconnect all apps. */
export const removeConnectorRedirect = action(z.object({ uri: z.string().max(2000) }), async ({ uri }) => {
  const redirects = (await loadSettings()).connectorRedirects.filter((entry) => entry !== uri);
  await saveSettings({ connectorRedirects: redirects });
  return { redirects };
});
