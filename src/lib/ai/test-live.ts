import { AiProvider } from "@/generated/prisma/enums";

import type { AiConfig } from "./config";

// For the live tests: they can use a key saved in the app instead of one
// given on the command line.

/**
 * What's saved in Settings → AI provider, key included, read the way the app
 * reads it: `.env` (HIREME_SECRET decrypts the key), then the database.
 */
export async function savedAiConfig(): Promise<AiConfig> {
  // Keeps what's set already, such as the DATABASE_URL Compose gives the container.
  process.loadEnvFile(".env");
  const { loadAiConfig } = await import("./config");
  return loadAiConfig();
}

/** Anthropic's key and model: HIREME_AI_KEY (and HIREME_AI_MODEL), or what's saved in Settings with Anthropic chosen. */
export async function liveAnthropic(): Promise<{ key: string; model: string } | null> {
  const fallbackModel = "claude-haiku-4-5";
  if (process.env.HIREME_AI_KEY) return { key: process.env.HIREME_AI_KEY, model: process.env.HIREME_AI_MODEL ?? fallbackModel };
  const saved = await savedAiConfig();
  return saved.provider === AiProvider.ANTHROPIC && saved.apiKey ? { key: saved.apiKey, model: saved.model ?? fallbackModel } : null;
}

/** Mistral's key and model: HIREME_AI_KEY (and HIREME_AI_MODEL), or what's saved in Settings with Mistral chosen. */
export async function liveMistral(): Promise<{ key: string; model: string } | null> {
  const fallbackModel = "mistral-small-2603";
  if (process.env.HIREME_AI_KEY) return { key: process.env.HIREME_AI_KEY, model: process.env.HIREME_AI_MODEL ?? fallbackModel };
  const saved = await savedAiConfig();
  return saved.provider === AiProvider.MISTRAL && saved.apiKey ? { key: saved.apiKey, model: saved.model ?? fallbackModel } : null;
}

/** LM Studio's address, token and model: HIREME_AI_MODEL (and HIREME_AI_URL, HIREME_AI_KEY), or what's saved in Settings with LM Studio chosen. */
export async function liveLmStudio(): Promise<{ url: string; key: string | null; model: string } | null> {
  const { HIREME_AI_URL, HIREME_AI_KEY, HIREME_AI_MODEL } = process.env;
  if (HIREME_AI_MODEL) return { url: HIREME_AI_URL ?? "http://host.docker.internal:1234", key: HIREME_AI_KEY ?? null, model: HIREME_AI_MODEL };
  const saved = await savedAiConfig();
  return saved.provider === AiProvider.LMSTUDIO && saved.model ? { url: saved.baseUrl, key: saved.apiKey, model: saved.model } : null;
}
