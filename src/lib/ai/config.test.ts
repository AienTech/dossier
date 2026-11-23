import { describe, expect, it, vi } from "vitest";

import { SCORING_AI_KEY, encryptSecret } from "@/lib/secrets";

import { encryptApiKey } from "./api-key";
import { isAiUsable, loadScoringAiConfig, loadScoringAiSettingsView, resolveAiConfig, resolveScoringAiConfig, sameServer } from "./config";
import { AiError } from "./errors";
import { createProvider } from "./index";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const saved = vi.hoisted(() => ({ settings: { provider: null, baseUrl: null, model: null, apiKeyEnc: null } as Record<string, unknown> }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => saved.settings }));

const noEnv = {} as Parameters<typeof resolveAiConfig>[1];
const nothingSaved = { provider: null, baseUrl: null, model: null, apiKeyEnc: null };

describe("resolveAiConfig", () => {
  it("defaults to a local model on the standard Ollama address", () => {
    expect(resolveAiConfig(null, noEnv)).toEqual({
      provider: "LOCAL",
      baseUrl: "http://localhost:11434",
      model: null,
      apiKey: null,
      apiKeyProblem: null,
      timeoutMs: 300_000,
    });
  });

  it("uses the DOSSIER_AI_* variables until a provider is saved", () => {
    const config = resolveAiConfig(nothingSaved, {
      DOSSIER_AI_PROVIDER: "anthropic",
      DOSSIER_AI_KEY: "sk-env",
      DOSSIER_AI_TIMEOUT_SECONDS: 90,
    });
    expect(config).toMatchObject({
      provider: "ANTHROPIC",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-5-5",
      apiKey: "sk-env",
      timeoutMs: 90_000,
    });
  });

  it("takes a timeout saved in Settings before DOSSIER_AI_TIMEOUT_SECONDS and the provider's own, for any provider (public issue 118)", () => {
    const env = { DOSSIER_AI_PROVIDER: "anthropic", DOSSIER_AI_TIMEOUT_SECONDS: 90 } as Parameters<typeof resolveAiConfig>[1];
    expect(resolveAiConfig({ ...nothingSaved, aiTimeoutSeconds: 900 }, env).timeoutMs).toBe(900_000);
    expect(resolveAiConfig({ ...nothingSaved, provider: "LMSTUDIO", aiTimeoutSeconds: 1_200 }, noEnv).timeoutMs).toBe(1_200_000);
    expect(resolveAiConfig({ ...nothingSaved, aiTimeoutSeconds: null }, env).timeoutMs).toBe(90_000);
  });

  it("knows Mistral's address and a default model", () => {
    expect(resolveAiConfig(nothingSaved, { DOSSIER_AI_PROVIDER: "mistral", DOSSIER_AI_KEY: "mk-env" })).toMatchObject({
      provider: "MISTRAL",
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-small-2603",
      apiKey: "mk-env",
      timeoutMs: 120_000,
    });
  });

  it("finds LM Studio on the Docker host, as patient as a local model", () => {
    expect(resolveAiConfig(nothingSaved, { DOSSIER_AI_PROVIDER: "lmstudio" })).toMatchObject({
      provider: "LMSTUDIO",
      baseUrl: "http://host.docker.internal:1234",
      model: null,
      timeoutMs: 300_000,
    });
  });

  it("prefers what's saved in Settings, with its own key", () => {
    const saved = { provider: "OPENAI" as const, baseUrl: "https://llm.example/v1", model: "gpt-x", apiKeyEnc: encryptApiKey("sk-saved") };
    const config = resolveAiConfig(saved, { DOSSIER_AI_PROVIDER: "local", DOSSIER_AI_URL: "http://ollama:11434", DOSSIER_AI_KEY: "sk-env" });
    expect(config).toMatchObject({ provider: "OPENAI", baseUrl: "https://llm.example/v1", model: "gpt-x", apiKey: "sk-saved", timeoutMs: 120_000 });
  });

  it("lends the env key only to a saved provider of the same kind", () => {
    const saved = { provider: "ANTHROPIC" as const, baseUrl: null, model: null, apiKeyEnc: null };
    expect(resolveAiConfig(saved, { DOSSIER_AI_PROVIDER: "anthropic", DOSSIER_AI_KEY: "sk-env" }).apiKey).toBe("sk-env");
    expect(resolveAiConfig(saved, { DOSSIER_AI_PROVIDER: "openai", DOSSIER_AI_KEY: "sk-env" }).apiKey).toBeNull();
  });

  it("lends the env key only to the env's own server (public PR 107)", () => {
    const source = { DOSSIER_AI_PROVIDER: "openai" as const, DOSSIER_AI_URL: "https://openrouter.ai/api/v1", DOSSIER_AI_KEY: "sk-or-env" };
    const saved = { provider: "OPENAI" as const, baseUrl: "https://api.deepseek.com", model: null, apiKeyEnc: null };
    expect(resolveAiConfig(saved, source).apiKey).toBeNull();
    expect(resolveAiConfig({ ...saved, baseUrl: "https://openrouter.ai/v1" }, source).apiKey).toBe("sk-or-env");
    // Neither address set: both are the provider's default.
    expect(resolveAiConfig({ ...saved, baseUrl: null }, { DOSSIER_AI_PROVIDER: "openai", DOSSIER_AI_KEY: "sk-env" }).apiKey).toBe("sk-env");
  });

  it("reports a saved key it can't read instead of failing", () => {
    const saved = { provider: "ANTHROPIC" as const, baseUrl: null, model: null, apiKeyEnc: encryptApiKey("sk", "b".repeat(32)) };
    const config = resolveAiConfig(saved, noEnv);
    expect(config).toMatchObject({ apiKey: null, apiKeyProblem: "Your saved API key can't be read. Please enter it again." });
    expect(() => createProvider(config)).toThrow(AiError);
  });
});

describe("resolveScoringAiConfig (public issue 170)", () => {
  const off = { scoringProvider: null, scoringBaseUrl: null, scoringModel: null, scoringApiKeyEnc: null };
  const main = { provider: "LOCAL" as const, baseUrl: "http://localhost:11434", model: "qwen", apiKey: "sk-main-env", apiKeyProblem: null, timeoutMs: 90_000 };

  it("is the main provider's until a scoring provider is saved", () => {
    expect(resolveScoringAiConfig(off, main)).toBe(main);
  });

  it("builds the override from its own settings, with the provider's defaults and the main timeout", () => {
    expect(resolveScoringAiConfig({ ...off, scoringProvider: "MISTRAL" }, main)).toEqual({
      provider: "MISTRAL",
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-small-2603",
      apiKey: null,
      apiKeyProblem: null,
      timeoutMs: 90_000,
    });
    const own = { scoringProvider: "OPENAI" as const, scoringBaseUrl: "https://llm.example/v1", scoringModel: "m", scoringApiKeyEnc: encryptSecret(SCORING_AI_KEY, "sk-score") };
    expect(resolveScoringAiConfig(own, main)).toMatchObject({ baseUrl: "https://llm.example/v1", model: "m", apiKey: "sk-score" });
  });

  it("reports a key it can't read, and never lends the main provider's key", () => {
    const enc = encryptSecret(SCORING_AI_KEY, "sk", "b".repeat(32));
    expect(resolveScoringAiConfig({ ...off, scoringProvider: "ANTHROPIC", scoringApiKeyEnc: enc }, main, undefined)).toMatchObject({ apiKey: null, apiKeyProblem: "Your saved API key can't be read. Please enter it again." });
    // A key saved for the main provider isn't the override's.
    expect(resolveScoringAiConfig({ ...off, scoringProvider: "ANTHROPIC", scoringApiKeyEnc: encryptApiKey("sk-main") }, main)?.apiKeyProblem).not.toBeNull();
    expect(resolveScoringAiConfig({ ...off, scoringProvider: "OPENAI" }, main).apiKey).toBeNull();
  });
});

describe("loadScoringAiConfig and loadScoringAiSettingsView", () => {
  it("fall back to the main provider while the override is off", async () => {
    saved.settings = { provider: "LOCAL", baseUrl: null, model: "qwen", apiKeyEnc: null, scoringProvider: null };
    expect(await loadScoringAiConfig()).toMatchObject({ provider: "LOCAL", model: "qwen" });
    expect(await loadScoringAiSettingsView()).toBeNull();
  });

  it("use the override, with the main timeout, and show its key state without the key", async () => {
    saved.settings = { provider: "LOCAL", baseUrl: null, model: "qwen", apiKeyEnc: null, aiTimeoutSeconds: 900, scoringProvider: "OPENAI", scoringBaseUrl: "https://llm.example/v1", scoringModel: "m", scoringApiKeyEnc: encryptSecret(SCORING_AI_KEY, "sk-score-1234") };
    expect(await loadScoringAiConfig()).toMatchObject({ provider: "OPENAI", model: "m", apiKey: "sk-score-1234", timeoutMs: 900_000 });
    expect(await loadScoringAiSettingsView()).toEqual({
      provider: "OPENAI",
      baseUrl: "https://llm.example/v1",
      model: "m",
      keyState: "set",
      keyEnding: "1234",
      test: null,
      timeoutSeconds: 900,
      envTimeoutSeconds: null,
    });
  });
});

describe("createProvider", () => {
  it("picks the implementation for the provider", () => {
    const base = { baseUrl: "http://x", model: "m", apiKey: "k", apiKeyProblem: null, timeoutMs: 1000 };
    expect(createProvider({ ...base, provider: "LOCAL" }).kind).toBe("LOCAL");
    expect(createProvider({ ...base, provider: "OPENAI" }).kind).toBe("OPENAI");
    expect(createProvider({ ...base, provider: "ANTHROPIC" }).kind).toBe("ANTHROPIC");
    expect(createProvider({ ...base, provider: "MISTRAL" }).kind).toBe("MISTRAL");
    expect(createProvider({ ...base, provider: "LMSTUDIO" }).kind).toBe("LMSTUDIO");
  });
});

describe("isAiUsable (#221)", () => {
  const usable = async (settings: Record<string, unknown>) => {
    saved.settings = { provider: null, baseUrl: null, model: null, apiKeyEnc: null, ...settings };
    return isAiUsable();
  };

  it("needs a provider with its model", async () => {
    expect(await usable({})).toBe(false);
    expect(await usable({ provider: "LOCAL" })).toBe(false);
    expect(await usable({ provider: "LOCAL", model: "qwen2.5:7b" })).toBe(true);
    // An OpenAI-compatible server may need no key.
    expect(await usable({ provider: "OPENAI", baseUrl: "http://llm.lan/v1", model: "gpt-x" })).toBe(true);
  });

  it("needs a readable key for the hosted providers that always need one", async () => {
    expect(await usable({ provider: "ANTHROPIC" })).toBe(false);
    expect(await usable({ provider: "ANTHROPIC", apiKeyEnc: encryptApiKey("sk-saved") })).toBe(true);
    expect(await usable({ provider: "MISTRAL", apiKeyEnc: encryptApiKey("sk", "b".repeat(32)) })).toBe(false);
  });
});

describe("sameServer", () => {
  it("compares scheme, host and port, with the provider's default for an empty address", () => {
    expect(sameServer("OPENAI", "https://openrouter.ai/v1", "https://OpenRouter.ai/api/v1/")).toBe(true);
    expect(sameServer("OPENAI", "", "https://api.openai.com/v1")).toBe(true);
    expect(sameServer("OPENAI", "https://openrouter.ai/api/v1", "https://openrouter.ai.example/api/v1")).toBe(false);
    expect(sameServer("OPENAI", "https://openrouter.ai", "http://openrouter.ai")).toBe(false);
    expect(sameServer("LMSTUDIO", "http://localhost:1234", "http://host.docker.internal:1234")).toBe(false);
    expect(sameServer("OPENAI", "https://", "https://")).toBe(false);
  });
});
