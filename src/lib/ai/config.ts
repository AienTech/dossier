import "server-only";

import { AiProvider } from "@/generated/prisma/enums";
import { env, type Env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { AiTask, SettingsData } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import { API_KEY_UNREADABLE, ApiKeyUnreadable, apiKeyState, decryptApiKey } from "./api-key";
import type { AiProfileView, AiSettingsView, KeyState } from "./provider-options";

// Which provider to use and how to reach it (E6-1): the saved profile a task
// uses, or else the DOSSIER_AI_* variables, or else the defaults below.

export type AiConfig = {
  provider: AiProvider;
  baseUrl: string;
  model: string | null;
  apiKey: string | null;
  /** Why the saved key can't be used, e.g. DOSSIER_SECRET changed. */
  apiKeyProblem: string | null;
  timeoutMs: number;
};

export const PROVIDER_DEFAULTS: Record<AiProvider, { baseUrl: string; model: string | null; timeoutSeconds: number }> = {
  // Generous: a local model on a laptop can take minutes for a cover letter.
  [AiProvider.LOCAL]: { baseUrl: "http://localhost:11434", model: null, timeoutSeconds: 300 },
  [AiProvider.OPENAI]: { baseUrl: "https://api.openai.com/v1", model: null, timeoutSeconds: 120 },
  [AiProvider.ANTHROPIC]: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5", timeoutSeconds: 120 },
  [AiProvider.MISTRAL]: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-medium-latest", timeoutSeconds: 120 },
  // As generous as a local model, and loading one can take a while too.
  [AiProvider.LMSTUDIO]: { baseUrl: "http://host.docker.internal:1234", model: null, timeoutSeconds: 300 },
};

const FROM_ENV: Record<NonNullable<Env["DOSSIER_AI_PROVIDER"]>, AiProvider> = {
  local: AiProvider.LOCAL,
  openai: AiProvider.OPENAI,
  anthropic: AiProvider.ANTHROPIC,
  mistral: AiProvider.MISTRAL,
  lmstudio: AiProvider.LMSTUDIO,
};

type SavedSettings = {
  provider: AiProvider | null;
  baseUrl: string | null;
  model: string | null;
  apiKeyEnc: string | null;
};

type AiEnv = Pick<
  Env,
  "DOSSIER_AI_PROVIDER" | "DOSSIER_AI_URL" | "DOSSIER_AI_MODEL" | "DOSSIER_AI_KEY" | "DOSSIER_AI_TIMEOUT_SECONDS"
>;

/**
 * A saved profile wins; without one the environment
 * decides. The two are never mixed, except that an env key still serves a
 * saved provider of the same kind that has no key of its own.
 */
export function resolveAiConfig(saved: SavedSettings | null, source: AiEnv, secret?: string): AiConfig {
  const envProvider = source.DOSSIER_AI_PROVIDER ? FROM_ENV[source.DOSSIER_AI_PROVIDER] : null;
  const useSaved = Boolean(saved?.provider);
  const provider = (useSaved ? saved!.provider : envProvider) ?? AiProvider.LOCAL;
  const defaults = PROVIDER_DEFAULTS[provider];

  let apiKey: string | null = null;
  let apiKeyProblem: string | null = null;
  if (useSaved && saved!.apiKeyEnc) {
    try {
      apiKey = decryptApiKey(saved!.apiKeyEnc, secret);
    } catch (error) {
      if (!(error instanceof ApiKeyUnreadable)) throw error;
      apiKeyProblem = API_KEY_UNREADABLE;
    }
  } else if (!useSaved || envProvider === provider) {
    apiKey = source.DOSSIER_AI_KEY ?? null;
  }

  return {
    provider,
    baseUrl: (useSaved ? saved!.baseUrl : source.DOSSIER_AI_URL) || defaults.baseUrl,
    model: (useSaved ? saved!.model : source.DOSSIER_AI_MODEL) || defaults.model,
    apiKey,
    apiKeyProblem,
    timeoutMs: (source.DOSSIER_AI_TIMEOUT_SECONDS ?? defaults.timeoutSeconds) * 1000,
  };
}

export type SavedProfile = SavedSettings & { id: string; name: string };

const PROFILE_SELECT = { id: true, name: true, provider: true, baseUrl: true, model: true, apiKeyEnc: true } as const;

/** Saved profiles, in their order. */
export async function loadAiProfiles(): Promise<SavedProfile[]> {
  return prisma.aiProfile.findMany({ select: PROFILE_SELECT, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
}

/** The profile `task` uses: its own, else the default, else the first. Null when none is saved. */
export function profileFor(profiles: readonly SavedProfile[], settings: Pick<SettingsData, "aiDefaultProfileId" | "aiTaskProfiles">, task: AiTask = "other"): SavedProfile | null {
  const byId = (id: string | null | undefined) => (id ? profiles.find((profile) => profile.id === id) : undefined);
  const own = task === "other" ? undefined : byId(settings.aiTaskProfiles[task]);
  return own ?? byId(settings.aiDefaultProfileId) ?? profiles[0] ?? null;
}

/** The AI configuration `task` uses right now. */
export async function loadAiConfig(task: AiTask = "other"): Promise<AiConfig> {
  const [profiles, settings] = await Promise.all([loadAiProfiles(), loadSettings()]);
  return resolveAiConfig(profileFor(profiles, settings, task), env);
}

/** One profile's configuration, or the environment's when `id` is null. */
export async function loadAiProfileConfig(id: string | null): Promise<AiConfig> {
  const profile = id ? await prisma.aiProfile.findUnique({ where: { id }, select: PROFILE_SELECT }) : null;
  return resolveAiConfig(profile, env);
}

/**
 * The AI settings as the settings screen shows them: each profile as in
 * effect, or what DOSSIER_AI_* sets when none is saved, and never a key.
 */
export async function loadAiSettingsView(): Promise<AiSettingsView> {
  const [profiles, settings] = await Promise.all([loadAiProfiles(), loadSettings()]);
  const viewOf = (profile: SavedProfile | null): AiProfileView => {
    const config = resolveAiConfig(profile, env);
    return {
      id: profile?.id ?? null,
      name: profile?.name ?? "",
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model ?? "",
      keyState: keyStateOf(profile, config),
    };
  };
  const fallback = profileFor(profiles, settings);
  return {
    profiles: profiles.length > 0 ? profiles.map(viewOf) : [viewOf(null)],
    defaultId: fallback?.id ?? null,
    tasks: { scoring: settings.aiTaskProfiles.scoring ?? null, writing: settings.aiTaskProfiles.writing ?? null },
  };
}

/** Whether a key is in play for the provider in effect, and where it comes from. */
export function keyStateOf(saved: { provider: AiProvider | null; apiKeyEnc: string | null } | null, config: AiConfig): KeyState {
  if (saved?.provider && saved.apiKeyEnc) return apiKeyState(saved.apiKeyEnc);
  return config.apiKey ? "env" : "none";
}

/** Whether an AI provider has been chosen, in Settings or with DOSSIER_AI_PROVIDER. */
export async function isAiConfigured(): Promise<boolean> {
  if (env.DOSSIER_AI_PROVIDER) return true;
  return (await prisma.aiProfile.count()) > 0;
}

/**
 * Whether Dossier's own AI model can be called for `task`: a provider with
 * its model, and a key for the hosted ones that always need one. Without
 * it, and with the Claude connector on, the AI buttons hand the work to
 * Claude chat (src/lib/connector/handoff.ts, #221).
 */
export async function isAiUsable(task: AiTask = "other"): Promise<boolean> {
  if (!(await isAiConfigured())) return false;
  const config = await loadAiConfig(task);
  if (!config.model || config.apiKeyProblem) return false;
  const needsKey = config.provider === AiProvider.ANTHROPIC || config.provider === AiProvider.MISTRAL;
  return !needsKey || Boolean(config.apiKey);
}
