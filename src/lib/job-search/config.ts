import "server-only";

import { env, type Env } from "@/lib/env";
import { decryptSecret, JOB_SOURCE_KEY, SecretUnreadable } from "@/lib/secrets";
import type { SettingsData } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import type { RequestContext, SourceCredentials } from "./adapter";
import { JobSearchError, jobSearchError } from "./errors";
import { JOB_SOURCES, type JobSource, type JSearchHost } from "./search";
import { ARBEITSAGENTUR_NOTE, FREEHIRE_URL, SOURCE_INFO, type JobKeyState, type JobSearchSettingsView } from "./sources";

// Which job sources to search, and with which keys (E14-4): what's saved in
// Settings, or else the DOSSIER_JOBS_* variables. Each source keeps its own
// key, so a key only ever goes to the source it's for.

export type JobSearchConfig = {
  /** The sources in effect, in JOB_SOURCES order; empty while job search is off. */
  sources: JobSource[];
  /** Whether the choice is saved in Settings, rather than coming from DOSSIER_JOBS_SOURCE. */
  saved: boolean;
  /** The host asked first, with its key; `fallback` is the other host when it has a key. */
  jsearch: {
    key: string | null;
    host: JSearchHost;
    keyState: JobKeyState;
    keyStates: Record<JSearchHost, JobKeyState>;
    fallback: { key: string; host: JSearchHost } | null;
  };
  adzuna: { appId: string; key: string | null; keyState: JobKeyState };
  /**
   * The Bundesagentur für Arbeit (#223): whether this server offers it, and
   * when its note was accepted. Its searches wait until then.
   */
  arbeitsagentur: { offered: boolean; acceptedAt: string | null };
  /** The FreeHire to search: freehire.me, or a self-hosted one (DOSSIER_FREEHIRE_URL). */
  freehire: { url: string };
};

type SavedJobSettings = Pick<
  SettingsData,
  "jobSources" | "jsearchKeyEnc" | "jsearchRapidapiKeyEnc" | "jsearchHost" | "adzunaAppId" | "adzunaKeyEnc" | "arbeitsagenturAcceptedAt"
>;
type JobEnv = Pick<
  Env,
  | "DOSSIER_JOBS_SOURCE"
  | "DOSSIER_JSEARCH_KEY"
  | "DOSSIER_JSEARCH_HOST"
  | "DOSSIER_ADZUNA_APP_ID"
  | "DOSSIER_ADZUNA_KEY"
  | "DOSSIER_FREEHIRE_URL"
  | "DOSSIER_JOBS_ARBEITSAGENTUR"
>;

const FROM_ENV: Record<NonNullable<Env["DOSSIER_JOBS_SOURCE"]>[number], JobSource | null> = {
  jsearch: "JSEARCH",
  adzuna: "ADZUNA",
  arbeitsagentur: "ARBEITSAGENTUR",
  freehire: "FREEHIRE",
  off: null,
};

/** A saved key, decrypted, or else the environment's. */
function keyOf(stored: string | null, fromEnv: string | undefined, secret?: string): { key: string | null; keyState: JobKeyState } {
  if (stored) {
    try {
      return { key: decryptSecret(JOB_SOURCE_KEY, stored, secret), keyState: "set" };
    } catch (error) {
      if (!(error instanceof SecretUnreadable)) throw error;
      return { key: null, keyState: "unreadable" };
    }
  }
  return fromEnv ? { key: fromEnv, keyState: "env" } : { key: null, keyState: "none" };
}

/**
 * JSearch's keys by host. An environment key belongs to DOSSIER_JSEARCH_HOST,
 * else to the saved host. The saved host is asked first unless only the
 * other one has a key.
 */
function jsearchKeys(saved: SavedJobSettings, source: JobEnv, secret?: string): JobSearchConfig["jsearch"] {
  const envHost = source.DOSSIER_JSEARCH_HOST ?? saved.jsearchHost;
  const slots: Record<JSearchHost, { key: string | null; keyState: JobKeyState }> = {
    openwebninja: keyOf(saved.jsearchKeyEnc, envHost === "openwebninja" ? source.DOSSIER_JSEARCH_KEY : undefined, secret),
    rapidapi: keyOf(saved.jsearchRapidapiKeyEnc, envHost === "rapidapi" ? source.DOSSIER_JSEARCH_KEY : undefined, secret),
  };
  const otherOf = (host: JSearchHost): JSearchHost => (host === "openwebninja" ? "rapidapi" : "openwebninja");
  const host = !slots[saved.jsearchHost].key && slots[otherOf(saved.jsearchHost)].key ? otherOf(saved.jsearchHost) : saved.jsearchHost;
  const other = otherOf(host);
  const fallbackKey = slots[other].key;
  return {
    ...slots[host],
    host,
    keyStates: { openwebninja: slots.openwebninja.keyState, rapidapi: slots.rapidapi.keyState },
    fallback: fallbackKey ? { key: fallbackKey, host: other } : null,
  };
}

export function resolveJobSearchConfig(saved: SavedJobSettings, source: JobEnv, secret?: string): JobSearchConfig {
  const offered = source.DOSSIER_JOBS_ARBEITSAGENTUR !== "off";
  const fromEnv = (source.DOSSIER_JOBS_SOURCE ?? []).flatMap((name) => FROM_ENV[name] ?? []);
  const chosen = new Set(saved.jobSources ?? fromEnv);
  return {
    // A BA choice saved before the server turned it off counts as off.
    sources: JOB_SOURCES.filter((entry) => chosen.has(entry) && (entry !== "ARBEITSAGENTUR" || offered)),
    saved: saved.jobSources !== null,
    jsearch: jsearchKeys(saved, source, secret),
    adzuna: {
      appId: saved.adzunaAppId ?? source.DOSSIER_ADZUNA_APP_ID ?? "",
      ...keyOf(saved.adzunaKeyEnc, source.DOSSIER_ADZUNA_KEY, secret),
    },
    arbeitsagentur: { offered, acceptedAt: saved.arbeitsagenturAcceptedAt },
    freehire: { url: source.DOSSIER_FREEHIRE_URL ?? FREEHIRE_URL },
  };
}

/** The sources the job agent searches: every chosen one but the Bundesagentur für Arbeit, whose terms forbid searching on one's own (#223). */
export const agentSources = (config: Pick<JobSearchConfig, "sources">): JobSource[] => config.sources.filter((source) => source !== "ARBEITSAGENTUR");

/** The job search configuration in effect right now. */
export async function loadJobSearchConfig(): Promise<JobSearchConfig> {
  return resolveJobSearchConfig(await loadSettings(), env);
}

/**
 * For the server log at start (#223): the Bundesagentur für Arbeit's note,
 * when DOSSIER_JOBS_SOURCE chooses it rather than Settings; null otherwise.
 */
export function arbeitsagenturStartupNotice(config: JobSearchConfig): string | null {
  if (!config.sources.includes("ARBEITSAGENTUR") || config.saved) return null;
  const waiting = config.arbeitsagentur.acceptedAt ? "" : " It isn't searched until you tick “I understand” in Settings → Job search.";
  return `Job search: DOSSIER_JOBS_SOURCE chooses the Bundesagentur für Arbeit. ${ARBEITSAGENTUR_NOTE}${waiting}`;
}

/** What Settings → Job search shows: the source and the keys' states, never the keys. */
export function jobSearchView(config: JobSearchConfig): JobSearchSettingsView {
  return {
    sources: config.sources,
    jsearch: { host: config.jsearch.host, keyState: config.jsearch.keyState, keyStates: config.jsearch.keyStates },
    adzuna: { appId: config.adzuna.appId, keyState: config.adzuna.keyState },
    arbeitsagentur: config.arbeitsagentur,
    freehire: { host: new URL(config.freehire.url).host },
  };
}

/**
 * Where a source's requests go: its own address, unless the end-to-end
 * tests point every source at their fake one (DOSSIER_JOBS_TEST_BASE_URL),
 * or FreeHire is pointed at a self-hosted origin (DOSSIER_FREEHIRE_URL).
 */
export function requestContext(
  source: JobSource,
  base = env.DOSSIER_JOBS_TEST_BASE_URL,
  freehireUrl = env.DOSSIER_FREEHIRE_URL,
): RequestContext {
  if (base) return { baseUrl: `${base.replace(/\/+$/, "")}/${source.toLowerCase()}` };
  if (source === "FREEHIRE" && freehireUrl) return { baseUrl: freehireUrl };
  return {};
}

/**
 * The key a source needs, or a JobSearchError saying what's missing. Every
 * request to a source asks here first, so the BA's switch and note (#223)
 * hold for Find jobs, saved postings, the job agent and the Claude connector.
 */
export function credentialsFor<S extends JobSource>(config: JobSearchConfig, source: S): SourceCredentials[S] {
  const missing = (keyState: JobKeyState) =>
    keyState === "unreadable"
      ? new JobSearchError("no-key", `Your saved ${SOURCE_INFO[source].name} key can't be read. Enter it again in Settings → Job search.`)
      : jobSearchError("no-key", source);
  switch (source) {
    case "JSEARCH": {
      const { key, host, keyState, fallback } = config.jsearch;
      if (!key) throw missing(keyState);
      return (fallback ? { key, host, fallback } : { key, host }) as SourceCredentials[S];
    }
    case "ADZUNA": {
      const { appId, key, keyState } = config.adzuna;
      if (!key || !appId) throw missing(keyState);
      return { appId, key } as SourceCredentials[S];
    }
    case "ARBEITSAGENTUR": {
      if (!config.arbeitsagentur.offered) throw jobSearchError("off", source);
      if (!config.arbeitsagentur.acceptedAt) throw jobSearchError("not-accepted", source);
      return {} as SourceCredentials[S];
    }
    case "FREEHIRE":
      return {} as SourceCredentials[S];
  }
}
