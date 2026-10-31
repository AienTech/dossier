import "server-only";
import { OpenAICompatibleProvider } from "./openai-compatible";

/**
 * Azure's v1 endpoint: `https://<resource>.openai.azure.com/openai/v1`. People
 * paste the resource address from the portal, so add the path when it's missing.
 */
export function azureBaseUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  return /\/openai\/v1$/.test(trimmed) ? trimmed : `${trimmed.replace(/\/openai$/, "")}/openai/v1`;
}

/**
 * Azure OpenAI (and AI Foundry) through its OpenAI-compatible v1 API. The
 * model is the name of a deployment. Quirks, like models refusing
 * `temperature`, are handled in the base class.
 */
export class AzureProvider extends OpenAICompatibleProvider {
  constructor(endpoint: string, apiKey: string | null, model: string | null, timeoutMs: number) {
    super("AZURE", azureBaseUrl(endpoint), apiKey, model, timeoutMs);
  }
}
