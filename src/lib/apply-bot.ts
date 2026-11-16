/**
 * Last-step apply via an external bot, then status/notes back into HireMe.
 *
 * - Claude (MCP connector): bot calls get_application, applies in its browser,
 *   then set_application_status / add_application_note. Closed loop.
 * - Grok Bot: no MCP; HireMe writes a local apply packet folder and copies a
 *   prompt that names that path. After submit you mark Sent in HireMe.
 */

import { APPLY_BOTS, type ApplyBot } from "@/lib/application-bots";
import { buildApplyBotPrompt, expectedSalaryLine, type ApplyPromptAnswers } from "@/lib/apply-prompt";
import { grokBotApplyPrompt, grokBotApplyPromptForDeepLink, grokBotApplyUrl } from "@/lib/grok-bot";

/** A new claude.ai chat that starts with `prompt` (same shape as the connector handoff). */
const claudeChatUrl = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

export { APPLY_BOTS, type ApplyBot } from "@/lib/application-bots";

export function isApplyBot(value: string): value is ApplyBot {
  return APPLY_BOTS.some((bot) => bot.value === value);
}

export type ClaudeApplyInput = {
  applicationId: string;
  company?: string;
  role?: string;
  title?: string;
  postingUrl?: string;
  applyUrl?: string;
  salary?: string;
  answers?: Partial<ApplyPromptAnswers>;
};

/** Claude.ai chat that applies using the connector tools, then writes status back. */
export function claudeApplyPrompt(input: ClaudeApplyInput): string {
  return buildApplyBotPrompt({
    jobTitle: (input.role || input.title || "").trim(),
    company: (input.company || "").trim(),
    postingUrl: (input.postingUrl || "").trim() || `(load from get_application "${input.applicationId}")`,
    applyUrl: input.applyUrl,
    applicationId: input.applicationId,
    answers: {
      location: input.answers?.location?.trim() || "",
      expectedSalary: input.answers?.expectedSalary?.trim() || expectedSalaryLine(input.salary),
      experience: input.answers?.experience?.trim() || "Use get_application / my HireMe profile — do not invent experience.",
    },
  });
}

export function claudeApplyUrl(input: ClaudeApplyInput): string {
  return claudeChatUrl(claudeApplyPrompt(input));
}

/** Opens Grok with a full clipboard prompt; deep link uses a compact version. */
export function grokApplyHandoff(input: {
  postingUrl: string;
  company?: string;
  role?: string;
  title?: string;
  applyUrl?: string;
  hasDocuments?: boolean;
  packetDir?: string;
  salary?: string;
  answers?: Partial<ApplyPromptAnswers>;
  grokBotId: string | null;
}): { href: string; prompt: string } {
  const prompt = grokBotApplyPrompt(input);
  const deepLinkText = grokBotApplyPromptForDeepLink(input);
  return { href: grokBotApplyUrl(input.grokBotId, deepLinkText), prompt };
}
