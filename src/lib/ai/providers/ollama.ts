import "server-only";

import { Ollama } from "ollama";
import { z } from "zod";

import { BaseProvider, type ChatAnswer, type ChatCall } from "../provider";

/**
 * Ollama wants the whole prompt to fit its context window and silently drops
 * the start of a longer one, and its default is small. A profile, a posting
 * and a tailored resume fit comfortably in this.
 */
const CONTEXT_TOKENS = 16_384;

/** A local model served by Ollama, through its own API (`/api/chat`). */
export class OllamaProvider extends BaseProvider {
  readonly kind = "LOCAL" as const;

  constructor(
    private readonly host: string,
    model: string | null,
    timeoutMs: number,
  ) {
    super(model, timeoutMs);
  }

  /** A client whose requests end when `signal` does. */
  private client(signal: AbortSignal): Ollama {
    return new Ollama({
      host: this.host,
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }),
    });
  }

  protected async chat(call: ChatCall): Promise<ChatAnswer> {
    const schema = call.json ? z.toJSONSchema(call.json.schema) : undefined;
    // A model on local hardware can think past any token limit and never answer, so it doesn't think.
    // One that doesn't think ignores `format`, so the schema goes into the instructions as well.
    const system = schema
      ? `${call.system}\n\nReply with only a JSON object, no other text, that matches this JSON schema:\n${JSON.stringify(schema)}`
      : call.system;
    const response = await this.client(call.signal).chat({
      model: call.model,
      messages: [{ role: "system", content: system }, ...call.messages],
      stream: false,
      think: false,
      format: schema,
      options: { temperature: call.temperature, num_predict: call.maxTokens, num_ctx: CONTEXT_TOKENS },
    });
    return { text: response.message.content, cutOff: response.done_reason === "length" };
  }

  protected async fetchModels(signal: AbortSignal): Promise<string[]> {
    const { models } = await this.client(signal).list();
    return models.map((model) => model.name).sort();
  }
}
