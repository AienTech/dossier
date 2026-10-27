import "server-only";

import { randomUUID } from "node:crypto";

import OpenAI from "openai";

import { appVersion } from "@/lib/version";

import { AiError } from "../errors";
import type { ChatAnswer, ChatCall } from "../provider";
import { OpenAICompatibleProvider } from "./openai-compatible";

const USER_AGENT = `Dossier/${appVersion} (+https://github.com/AienTech/dossier)`;

/**
 * OpenCode Go, through its OpenAI-compatible endpoint. Go asks clients to
 * identify themselves and send a stable session header, and its model list
 * lives outside the OpenAI-compatible path.
 */
export class OpenCodeGoProvider extends OpenAICompatibleProvider {
  private readonly apiKey: string | null;
  private readonly root: string;
  private readonly session: string;

  constructor(address: string, apiKey: string | null, model: string | null, timeoutMs: number, sessionId?: string) {
    const root = openCodeGoRoot(address);
    const session = openCodeGoSession(sessionId);
    super("OPENCODE_GO", `${root}/openai/v1`, apiKey, model, timeoutMs, {
      "User-Agent": USER_AGENT,
      "x-opencode-session": session,
    });
    this.apiKey = apiKey;
    this.root = root;
    this.session = session;
  }

  /** Some Go models refuse `response_format`; the schema goes in the instructions instead. */
  protected override defaultJsonMode(): "prompt" {
    return "prompt";
  }

  protected override async chat(call: ChatCall): Promise<ChatAnswer> {
    if (!this.apiKey) throw AiError.config("Add your OpenCode API key in Settings → AI provider first.");
    try {
      return await super.chat(call);
    } catch (error) {
      const mapped = goError(error);
      if (mapped) throw mapped;
      throw error;
    }
  }

  /** The Go catalog is public, so the model list works before a key is saved. */
  protected override async fetchModels(signal: AbortSignal): Promise<string[]> {
    const response = await fetch(`${this.root}/v1/models`, {
      headers: {
        "User-Agent": USER_AGENT,
        "x-opencode-session": this.session,
        Accept: "application/json",
      },
      signal,
    });
    if (!response.ok) {
      throw Object.assign(new Error(`OpenCode Go's model list failed with HTTP ${response.status}.`), {
        name: "OpenCodeGoError",
        status: response.status,
      });
    }
    const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
    const entries = Array.isArray(body?.data) ? body.data : [];
    return entries
      .flatMap((entry) => {
        const id = (entry as { id?: unknown })?.id;
        return typeof id === "string" ? [id] : [];
      })
      .sort();
  }
}

/** The Go root from either the documented base URL or the OpenAI-compatible one. */
export function openCodeGoRoot(address: string): string {
  return address
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(?:openai\/v1|openai|v1)$/, "");
}

/** A session ID in the form OpenCode expects: the given conversation, or a random one for a one-off call. */
export function openCodeGoSession(sessionId?: string): string {
  const id = sessionId?.trim() || randomUUID();
  return id.startsWith("ses_") ? id : `ses_${id}`;
}

/** Go's 403s say whether it's the plan, the workspace's privacy settings or a free model. */
function goError(error: unknown): AiError | null {
  if (error instanceof AiError) return error;
  if (error instanceof OpenAI.PermissionDeniedError) {
    const message = error.message;
    if (/active OpenCode Go subscription|Go models|Go subscription|Account\.Disabled/i.test(message)) {
      return AiError.config(
        "This OpenCode API key isn't on a Go or Go Plus plan. Subscribe in the OpenCode Console, or pick another provider in Settings → AI provider.",
      );
    }
    if (/regions?|privacy/i.test(message)) {
      return AiError.config(
        "OpenCode blocks this model for your workspace's region. In the OpenCode Console, allow Global regions under Settings → Privacy, or pick another model.",
      );
    }
    if (/train|contributor/i.test(message)) {
      return AiError.config(
        "This model is only available if your OpenCode workspace allows paid endpoints that train on request data. Change that in the OpenCode Console under Settings → Privacy, or pick another model.",
      );
    }
    if (/free[- ]tier|free models?/i.test(message)) {
      return AiError.config("That model is only available inside OpenCode. Pick a paid model included in your Go plan.");
    }
    return AiError.of("auth", "PermissionDeniedError 403");
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new AiError(
      "rate-limited",
      "OpenCode is limiting requests right now. If you've reached your Go plan's 5-hour, weekly or monthly limit, check the OpenCode Console; otherwise wait a minute and try again.",
      "RateLimitError 429",
    );
  }
  return null;
}
