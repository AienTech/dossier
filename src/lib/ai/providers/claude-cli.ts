import "server-only";

import { spawn } from "node:child_process";
import { toJSONSchema } from "zod";

import { AiError } from "../errors";
import { BaseProvider, withJsonSchema, type ChatAnswer, type ChatCall, type ChatMessage } from "../provider";

/** Aliases Claude Code accepts with `--model`, plus common full ids. */
export const CLAUDE_CLI_FALLBACK_MODELS = [
  "sonnet",
  "opus",
  "haiku",
  "claude-sonnet-5",
  "claude-opus-5-5",
  "claude-haiku-4-5",
  "claude-fable-5-1",
];

const BRIDGE_UNREACHABLE =
  "Couldn't reach the Claude CLI bridge. On this computer run `node scripts/claude-cli-bridge.mjs`, then try again. In Docker the address is usually http://host.docker.internal:3460.";

/**
 * zod's JSON Schema with the `$schema` (draft 2020-12) key dropped: Claude
 * Code's `--json-schema` validator can't resolve that meta-schema and rejects it.
 */
export function cliJsonSchema(schema: Parameters<typeof toJSONSchema>[0]): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

type CliResult = {
  result?: string;
  structured_output?: unknown;
  is_error?: boolean;
  subtype?: string;
  stop_reason?: string;
};

/** Whether `baseUrl` points at the HTTP bridge (Docker) rather than a local binary. */
export function isClaudeCliBridgeUrl(baseUrl: string): boolean {
  return /^https?:\/\//i.test(baseUrl.trim());
}

/**
 * Claude Code CLI as Dossier's AI provider: either spawns `claude -p` on the
 * same machine, or (when the address is http/https) calls the host bridge so
 * Docker can use the Mac/Windows Claude install.
 */
export class ClaudeCliProvider extends BaseProvider {
  readonly kind = "CLAUDE_CLI" as const;

  constructor(
    private readonly baseURL: string,
    model: string | null,
    timeoutMs: number,
  ) {
    super(model, timeoutMs);
  }

  protected override acceptsTemperature(): boolean {
    return false;
  }

  protected async chat(call: ChatCall): Promise<ChatAnswer> {
    if (isClaudeCliBridgeUrl(this.baseURL)) return this.bridgeChat(call);
    return this.spawnChat(call);
  }

  protected async fetchModels(signal: AbortSignal): Promise<string[]> {
    if (isClaudeCliBridgeUrl(this.baseURL)) {
      try {
        const response = await fetch(`${this.baseURL.replace(/\/+$/, "")}/models`, { signal });
        if (!response.ok) return CLAUDE_CLI_FALLBACK_MODELS;
        const body = (await response.json()) as { models?: unknown };
        const models = Array.isArray(body.models) ? body.models.filter((name): name is string => typeof name === "string" && name.length > 0) : [];
        return models.length > 0 ? models : CLAUDE_CLI_FALLBACK_MODELS;
      } catch (error) {
        if (signal.aborted) throw error;
        return CLAUDE_CLI_FALLBACK_MODELS;
      }
    }
    return CLAUDE_CLI_FALLBACK_MODELS;
  }

  private async bridgeChat(call: ChatCall): Promise<ChatAnswer> {
    const root = this.baseURL.replace(/\/+$/, "");
    let response: Response;
    try {
      response = await fetch(`${root}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: call.model,
          system: call.json ? withJsonSchema(call.system, call.json.schema) : call.system,
          messages: call.messages,
          maxTokens: call.maxTokens,
          jsonSchema: call.json ? cliJsonSchema(call.json.schema) : undefined,
        }),
        signal: call.signal,
      });
    } catch (error) {
      if (call.signal.aborted) throw error;
      throw new AiError("unreachable", BRIDGE_UNREACHABLE, error instanceof Error ? error.message : undefined);
    }
    if (!response.ok) {
      const bridgeError = await response
        .json()
        .then((body: { error?: unknown }) => (typeof body.error === "string" ? body.error : undefined))
        .catch(() => undefined);
      // The bridge answered but Claude Code failed: show Claude's own message.
      if (response.status === 500 && bridgeError) {
        throw new AiError("provider", `Claude CLI error: ${bridgeError}`, bridgeError);
      }
      const detail = `${response.status}`;
      if (response.status === 404 || response.status >= 500) {
        throw new AiError("unreachable", BRIDGE_UNREACHABLE, detail);
      }
      throw AiError.of("provider", detail);
    }
    const body = (await response.json()) as { text?: unknown; cutOff?: unknown };
    if (typeof body.text !== "string") throw AiError.of("invalid-output", "bridge response missing text");
    return { text: body.text, cutOff: body.cutOff === true };
  }

  private async spawnChat(call: ChatCall): Promise<ChatAnswer> {
    const binary = this.baseURL.trim() || "claude";
    const args = [
      "-p",
      "--output-format",
      "json",
      "--tools",
      "",
      "--permission-mode",
      "bypassPermissions",
      "--model",
      call.model,
      "--system-prompt",
      call.json ? withJsonSchema(call.system, call.json.schema) : call.system,
    ];
    if (call.json) {
      args.push("--json-schema", JSON.stringify(cliJsonSchema(call.json.schema)));
    }
    args.push(formatPrompt(call.messages));

    const raw = await runClaude(binary, args, this.timeoutMs, call.signal);
    return parseCliOutput(raw, Boolean(call.json));
  }
}

/** Flattens the chat into one prompt Claude Code's print mode can take. */
export function formatPrompt(messages: ChatMessage[]): string {
  return messages
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
    .join("\n\n");
}

/** Reads the print-mode JSON wrapper (and structured_output when present). */
export function parseCliOutput(raw: string, expectStructured: boolean): ChatAnswer {
  let parsed: CliResult;
  try {
    parsed = JSON.parse(raw) as CliResult;
  } catch {
    const text = raw.trim();
    if (!text) throw AiError.of("invalid-output", "empty Claude CLI output");
    return { text, cutOff: false };
  }
  if (parsed.is_error === true) {
    throw new AiError(
      "provider",
      typeof parsed.result === "string" ? parsed.result : "Claude CLI reported an error. Check that you're signed in (`claude auth status`).",
      parsed.subtype,
    );
  }
  if (expectStructured && parsed.structured_output !== undefined) {
    return { text: JSON.stringify(parsed.structured_output), cutOff: false };
  }
  if (typeof parsed.result === "string") {
    return { text: parsed.result, cutOff: parsed.stop_reason === "max_tokens" };
  }
  throw AiError.of("invalid-output", "Claude CLI returned no result text");
}

function runClaude(binary: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const onAbort = () => {
      child.kill("SIGTERM");
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        reject(
          AiError.config(
            `Couldn't find the Claude CLI (“${binary}”). Install Claude Code, or set the Server address to the bridge URL (http://host.docker.internal:3460) when Dossier runs in Docker.`,
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (code === 0 || stdout.trim()) {
        resolve(stdout.trim());
        return;
      }
      reject(new AiError("provider", "Claude CLI exited without an answer. Are you signed in?", stderr.slice(0, 500) || `exit ${code}`));
    });
  });
}
