/** Grok Bot supports prefilled prompt links (1,000 characters), sent only after the user clicks Send. */

import {
  buildApplyBotPrompt,
  buildApplyBotPromptCompact,
  expectedSalaryLine,
  type ApplyPromptAnswers,
} from "@/lib/apply-prompt";

/** Composer / paste text should stay short when a prompt deep link exists. */
export const GROK_BOT_PROMPT_MAX = 1000;

/** Opens the Grok Bot desktop/mobile app (no Bot selected). */
export const GROK_BOT_APP_SCHEME = "grokbot://";

/** Pulls a Bot id from a pasted link, or returns a trimmed bare id. */
export function parseGrokBotId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    if (/^https?:\/\//i.test(raw) || raw.startsWith("grokbot://")) {
      const url = new URL(raw);
      const fromQuery = url.searchParams.get("id")?.trim();
      if (fromQuery) return fromQuery;
      const parts = url.pathname.split("/").filter(Boolean);
      const last = parts.at(-1)?.trim();
      if (last && last !== "prompt" && last !== "bot" && last !== "v1" && last !== "app") return last;
    }
  } catch {
    // Not a URL — treat as a bare id below.
  }
  if (/^[\w.-]{6,200}$/.test(raw)) return raw;
  return null;
}

export type GrokApplyPromptInput = {
  postingUrl: string;
  company?: string;
  role?: string;
  title?: string;
  applyUrl?: string;
  /** Tailored resume and/or cover letter exist for this application. */
  hasDocuments?: boolean;
  /** Absolute path to the local apply packet folder HireMe just wrote. */
  packetDir?: string;
  /** Optional salary / location / experience for standard answers. */
  answers?: Partial<ApplyPromptAnswers>;
  salary?: string;
};

function answersFor(input: GrokApplyPromptInput): ApplyPromptAnswers {
  return {
    location: input.answers?.location?.trim() || "",
    expectedSalary: input.answers?.expectedSalary?.trim() || expectedSalaryLine(input.salary),
    experience: input.answers?.experience?.trim() || "See my resume in the materials; do not invent experience.",
  };
}

/** Full multi-line apply prompt for the clipboard (paste into Grok Bot). */
export function grokBotApplyPrompt(input: GrokApplyPromptInput): string {
  return buildApplyBotPrompt({
    jobTitle: (input.role || input.title || "").trim(),
    company: (input.company || "").trim(),
    postingUrl: input.postingUrl,
    applyUrl: input.applyUrl,
    packetDir: input.packetDir,
    hasDocuments: input.hasDocuments,
    answers: answersFor(input),
  });
}

/** Short prompt for grokbot:// deep links that have a length budget. */
export function grokBotApplyPromptForDeepLink(input: GrokApplyPromptInput): string {
  return buildApplyBotPromptCompact(
    {
      jobTitle: (input.role || input.title || "").trim(),
      company: (input.company || "").trim(),
      postingUrl: input.postingUrl,
      applyUrl: input.applyUrl,
      packetDir: input.packetDir,
      hasDocuments: input.hasDocuments,
      answers: answersFor(input),
    },
    GROK_BOT_PROMPT_MAX,
  );
}

/**
 * App deep link that opens a Bot with `text` typed (when the installed Grok Bot
 * supports prompt links). Conversation IDs from “Copy conversation ID” will not work.
 */
export function grokBotAppUrl(botId: string | null, text: string): string {
  const url = new URL("grokbot://app/v1/prompt");
  if (botId) url.searchParams.set("id", botId);
  // Grok rejects decoded control characters (including newlines) in prompt links.
  const singleLine = text.replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "").replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
  url.searchParams.set("text", singleLine.slice(0, GROK_BOT_PROMPT_MAX).replace(/[\uD800-\uDBFF]$/, ""));
  return url.toString();
}

/** Prefill the selected Bot, or the user’s primary Bot when no ID is configured. */
export function grokBotApplyUrl(botId: string | null, text: string): string {
  return grokBotAppUrl(botId, text);
}
