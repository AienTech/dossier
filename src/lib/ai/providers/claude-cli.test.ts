import { describe, expect, it } from "vitest";
import { z } from "zod";

import { cliJsonSchema, formatPrompt, isClaudeCliBridgeUrl, parseCliOutput } from "./claude-cli";

describe("Claude CLI helpers", () => {
  it("drops zod's $schema so Claude Code accepts --json-schema", () => {
    const schema = cliJsonSchema(z.object({ score: z.number() }));
    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toMatchObject({ type: "object" });
  });

  it("treats http addresses as the Docker bridge", () => {
    expect(isClaudeCliBridgeUrl("http://host.docker.internal:3460")).toBe(true);
    expect(isClaudeCliBridgeUrl("https://example/bridge")).toBe(true);
    expect(isClaudeCliBridgeUrl("")).toBe(false);
    expect(isClaudeCliBridgeUrl("/usr/local/bin/claude")).toBe(false);
    expect(isClaudeCliBridgeUrl("claude")).toBe(false);
  });

  it("flattens chat turns for print mode", () => {
    expect(
      formatPrompt([
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Again" },
      ]),
    ).toBe("User: Hi\n\nAssistant: Hello\n\nUser: Again");
  });

  it("reads print-mode JSON and structured_output", () => {
    expect(parseCliOutput(JSON.stringify({ result: "OK", is_error: false }), false)).toEqual({ text: "OK", cutOff: false });
    expect(parseCliOutput(JSON.stringify({ structured_output: { ok: true }, result: "{}" }), true)).toEqual({
      text: '{"ok":true}',
      cutOff: false,
    });
    expect(parseCliOutput("plain text", false)).toEqual({ text: "plain text", cutOff: false });
  });
});
