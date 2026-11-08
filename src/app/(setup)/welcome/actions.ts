"use server";

import { z } from "zod";

import { AiProvider } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { AiError, createProvider } from "@/lib/ai";
import { applyApiKeyChange } from "@/lib/ai/api-key";
import { loadAiConfig } from "@/lib/ai/config";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { AI_CHOICES, aiChoice, LOCAL_ADDRESSES, pickModel, type AiChoiceId } from "@/lib/setup/ai-choices";
import { SETUP_STEPS } from "@/lib/setup-guide";

/** Remembers the step the guide is on; Done, or leaving the guide, finishes it (E21). */
export const saveSetupGuide = action(z.object({ step: z.enum(SETUP_STEPS), finished: z.boolean() }), async (setupGuide) => {
  await saveSettings({ setupGuide });
  return null;
});

const CHECK_TIMEOUT_MS = 60_000;
const choiceIds = AI_CHOICES.map((choice) => choice.id) as [AiChoiceId, ...AiChoiceId[]];

/**
 * The AI step's Check (E21-2): saves a hosted provider with its key, picks
 * the first of the guide's models the account has, and sends it a short
 * question. Without a key, it checks the one saved for the same provider.
 * Saved either way, so a key waiting for credit doesn't have to be pasted
 * again.
 */
export const connectAi = action(
  z.object({
    choice: z.enum(choiceIds),
    key: z.string().trim().max(1000).optional(),
    baseUrl: z.string().trim().max(500).optional(),
    endpoint: z.enum(["chat/completions", "/responses"]).optional(),
    model: z.string().trim().max(200).optional(),
  }),
  async ({ choice: id, key, baseUrl: customUrl, endpoint: customEndpoint, model: customModel }) => {
    const choice = aiChoice(id);
    if (!choice.key) throw new ActionError(`${choice.name} runs on your computer, so there's no key to check.`);
    const saved = await loadSettings();

    const isOpenAiCompatible = id === "openai-compatible";
    const baseUrl = isOpenAiCompatible ? (customUrl || "https://api.openai.com/v1") : choice.baseUrl;
    const endpoint = isOpenAiCompatible ? (customEndpoint || "chat/completions") : undefined;

    const same = saved.provider === choice.provider && saved.baseUrl === baseUrl;
    const apiKeyEnc = key ? applyApiKeyChange(null, { action: "set", value: key }) : same ? saved.apiKeyEnc : null;
    if (!isOpenAiCompatible && !apiKeyEnc) return { connected: false as const, kind: "auth" as const, message: `Paste your ${choice.key.label} first.` };

    const initialModel = isOpenAiCompatible ? (customModel || null) : choice.models[0];
    await saveSettings({
      provider: choice.provider,
      baseUrl,
      model: initialModel,
      apiKeyEnc,
      ...(endpoint ? { aiEndpoint: endpoint } : {}),
    });

    const config = { ...(await loadAiConfig()), timeoutMs: CHECK_TIMEOUT_MS };
    try {
      let served: string[] = [];
      try {
        served = await createProvider(config).listModels(AbortSignal.timeout(15_000));
      } catch (error) {
        // A server without a model list still answers; a wrong key or no connection is the answer already.
        if (!(error instanceof AiError) || error.kind === "auth" || error.kind === "unreachable" || error.kind === "config") throw error;
      }
      let model = initialModel;
      if (!model) {
        if (choice.models.length > 0) {
          model = pickModel(choice.models, served);
        } else if (served.length > 0) {
          model = served[0];
        }
      }
      if (!model) {
        return {
          connected: false as const,
          kind: "model" as const,
          message: isOpenAiCompatible
            ? "Enter a model name to use with this server."
            : `Your ${choice.name} account doesn't offer the models Dossier uses: ${choice.models.join(" or ")}.`,
          availableModels: served,
        };
      }
      await saveSettings({ model });
      const { latencyMs } = await createProvider({ ...config, model }).test(AbortSignal.timeout(CHECK_TIMEOUT_MS));
      return { connected: true as const, model, seconds: Math.round(latencyMs / 100) / 10, availableModels: served };
    } catch (error) {
      if (error instanceof AiError) return { connected: false as const, kind: error.kind, message: error.message };
      throw error;
    }
  },
);

export const fetchChoiceModels = action(
  z.object({
    baseUrl: z.string().trim().max(500),
    key: z.string().trim().max(1000).optional(),
    endpoint: z.enum(["chat/completions", "/responses"]).optional(),
  }),
  async ({ baseUrl, key, endpoint }) => {
    const config = {
      provider: AiProvider.OPENAI,
      baseUrl: baseUrl || "https://api.openai.com/v1",
      model: null,
      apiKey: key || null,
      apiKeyProblem: null,
      timeoutMs: 15_000,
      endpoint: endpoint || "chat/completions",
    };
    try {
      const models = await createProvider(config).listModels(AbortSignal.timeout(15_000));
      return { models };
    } catch (error) {
      if (error instanceof AiError) return { models: [], error: error.message };
      throw error;
    }
  },
);

/**
 * The AI step's Find (E21-2): looks for LM Studio or Ollama where they
 * usually answer on this computer, with Docker or without, and saves the
 * first that does, with a model it has.
 */
export const findLocalAi = action(z.object({ choice: z.enum(["lmstudio", "ollama"]) }), async ({ choice: id }) => {
  const choice = aiChoice(id);
  const saved = await loadSettings();
  for (const baseUrl of LOCAL_ADDRESSES[id]) {
    let models: string[];
    try {
      models = await createProvider({ provider: choice.provider, baseUrl, model: null, apiKey: null, apiKeyProblem: null, timeoutMs: 5_000 }).listModels(
        AbortSignal.timeout(5_000),
      );
    } catch (error) {
      if (error instanceof AiError) continue;
      throw error;
    }
    const same = saved.provider === choice.provider;
    const model = same && saved.model && models.includes(saved.model) ? saved.model : (models[0] ?? null);
    await saveSettings({ provider: choice.provider, baseUrl, model, apiKeyEnc: same ? saved.apiKeyEnc : null });
    return { found: true as const, baseUrl, models, model };
  }
  return { found: false as const };
});
