import "server-only";

import { AiProvider } from "@/generated/prisma/enums";

import { loadAiConfig, type AiConfig } from "./config";
import { AiError } from "./errors";
import type { AIProvider } from "./provider";
import { AnthropicProvider } from "./providers/anthropic";
import { LocalProvider } from "./providers/local";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";

export { AiError } from "./errors";
export type { AIProvider, ChatMessage, CompletionRequest, JsonCompletionRequest } from "./provider";

/** A provider for `config`. A saved key that can't be read stops hosted providers with a clear message. */
export function createProvider(config: AiConfig): AIProvider {
  const { provider, baseUrl, model, apiKey, apiKeyProblem, timeoutMs } = config;
  if (apiKeyProblem && provider !== AiProvider.LOCAL) throw AiError.config(apiKeyProblem);
  switch (provider) {
    case AiProvider.LOCAL:
      return new LocalProvider(baseUrl, model, timeoutMs);
    case AiProvider.OPENAI:
      return new OpenAICompatibleProvider("OPENAI", baseUrl, apiKey, model, timeoutMs);
    case AiProvider.ANTHROPIC:
      return new AnthropicProvider(baseUrl, apiKey, model, timeoutMs);
  }
}

/** The provider configured in Settings, or by the DOSSIER_AI_* variables. */
export async function getAiProvider(): Promise<AIProvider> {
  return createProvider(await loadAiConfig());
}
