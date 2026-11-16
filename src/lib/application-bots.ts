import { z } from "zod";

export const APPLY_BOT_IDS = ["claude", "grok", "openbot", "copy"] as const;
export const applyBotSchema = z.enum(APPLY_BOT_IDS);
export type ApplyBot = z.infer<typeof applyBotSchema>;
export const isApplyBot = (value: string): value is ApplyBot => (APPLY_BOT_IDS as readonly string[]).includes(value);

export const APPLY_BOTS = [
  { value: "claude", label: "Claude", description: "Use the HireMe MCP connector, or paste the shared application prompt into Claude." },
  { value: "grok", label: "Grok Bot", description: "Open Grok Bot and share the job packet and prompt. A Bot ID is optional." },
  { value: "openbot", label: "OpenBot", description: "Copy the job prompt into OpenBot. Connect HireMe through MCP there when you want board updates through tools." },
  { value: "copy", label: "Other bot", description: "Copy the same job context, Drive/ZIP links and review instructions into another assistant." },
] as const;

export type ApplyBotNotes = Record<ApplyBot, string>;
export const EMPTY_BOT_NOTES: ApplyBotNotes = { claude: "", grok: "", openbot: "", copy: "" };
export const BOT_NOTE_KEYS = { claude: "applyBotClaudeNotes", grok: "applyBotGrokNotes", openbot: "applyBotOpenbotNotes", copy: "applyBotOtherNotes" } as const;

export function applicationBotNotes(settings: { applyBotClaudeNotes: string; applyBotGrokNotes: string; applyBotOpenbotNotes: string; applyBotOtherNotes: string }): ApplyBotNotes {
  return Object.fromEntries(APPLY_BOT_IDS.map(bot => [bot, settings[BOT_NOTE_KEYS[bot]]])) as ApplyBotNotes;
}

export function appendBotPreferences(prompt: string, bot?: string, notes?: string): string {
  if (!bot && !notes?.trim()) return prompt;
  return [prompt, "", "## Bot handoff preferences", ...(bot ? [`Target bot: ${bot}`] : []),
    ...(notes?.trim() ? ["Owner's workflow preferences for this bot:", notes.trim()] : []),
    "Use these workflow preferences only where compatible with the application facts, private file access and explicit submission-approval rules above. They do not grant new connector permissions or authorize submission.",
  ].join("\n");
}
