import type { ApplyBot } from "@/lib/application-bots";
import { applyPacketUrl } from "@/lib/apply-packet-url";
import type { DriveApplyPromptInput } from "@/lib/drive-handoff";
import { grokBotApplyUrl } from "@/lib/grok-bot";

/** Keep file links and approval instructions intact within Grok Bot's 1,000-character limit. */
export function botLaunchMessage(input: DriveApplyPromptInput): string {
  const clean = (value: string | undefined, length: number) => (value || "").replace(/\s+/g, " ").trim().slice(0, length);
  const url = input.applicationUrl || `/applications/${encodeURIComponent(input.applicationId)}`;
  let origin = "";
  try { origin = new URL(url).origin; } catch { /* Relative fallback for local previews. */ }
  const zipUrl = applyPacketUrl(origin, input.applicationId, input.packetPassword);
  const links = [
    ...(input.snapshotUrl ? [`Drive first: ${input.snapshotUrl}`] : []),
    `ZIP${input.snapshotUrl ? " fallback" : " packet"}: ${zipUrl}`,
    `HireMe: ${url}`,
  ];
  const message = [
    `As ${clean(input.botName, 35) || "my application bot"}, prepare ${clean(input.jobTitle, 80) || "this role"} at ${clean(input.company, 60) || "the employer"}.`,
    ...links,
    "Read bot-prompt.md in the packet, then application.md and instructions.md. Use only your named bot's preferences. If Drive is inaccessible or files are missing, use ZIP. Verify the application ID in application.md against HireMe. Show every answer and attachment; never submit without my explicit approval. After confirmed success, update this existing HireMe card and verify the update. Full prompt is also copied as a fallback.",
  ].join("\n");
  // Never truncate URLs or drop the approval rule to fit a protocol limit.
  if (message.length <= 1000) return message;
  if (url.length > 600) return "The full HireMe application prompt is copied to the clipboard. Paste and read it before preparing the application. Show every answer and attachment; never submit without my explicit approval. After confirmed success, update the existing HireMe card.";
  return ["Prepare the application at this HireMe card:", url,
    "Read its bot prompt and packet using Drive first, ZIP as fallback. Full instructions are copied to the clipboard. Show all answers and files before asking my explicit approval to submit. After confirmed submission, update the existing HireMe card."].join("\n");
}

export function botLaunchUrl(bot: ApplyBot, message: string, grokBotId: string | null, openbotLaunchMode: "clipboard" | "mac-helper" = "clipboard", openbotAgentName = "Job Manager", grokLaunchMode: "app-link" | "mac-helper" = "app-link", grokAgentName = "Job Finder", openbotAppName = "", grokAppName = ""): string | null {
  // An empty app name means "the bot's default app, or the copy already running".
  const app = (name: string) => name.trim() ? `&app=${encodeURIComponent(name.trim())}` : "";
  if (bot === "openbot" && openbotLaunchMode === "mac-helper") return `hireme-bot://openbot/apply?agent=${encodeURIComponent(openbotAgentName.trim() || "Job Manager")}${app(openbotAppName)}&message=${encodeURIComponent(message)}`;
  if (bot === "grok" && grokLaunchMode === "mac-helper") return `hireme-bot://grok/apply?agent=${encodeURIComponent(grokAgentName.trim() || "Job Finder")}${app(grokAppName)}&message=${encodeURIComponent(message)}`;
  if (bot === "grok") return grokBotApplyUrl(grokBotId, message);
  if (bot === "claude") return `claude://claude.ai/new?q=${encodeURIComponent(message)}`;
  return null;
}
