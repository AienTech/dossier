"use client";

import { useState } from "react";

import { saveFile } from "@/lib/save-file";
import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { APPLY_BOTS, appendBotPreferences } from "@/lib/application-bots";
import { driveApplyPrompt, type DriveApplyPromptInput } from "@/lib/drive-handoff";
import { grokBotApplyUrl } from "@/lib/grok-bot";
import { type ApplyBot, claudeApplyUrl, grokApplyHandoff } from "@/lib/apply-bot";

import { prepareGrokApplyPacket } from "./actions";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      field.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Opens a URL during the click (custom schemes included). Never uses about:blank. */
function openHref(href: string): void {
  const opened = window.open(href, "_blank", "noopener");
  if (opened) return;
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Last-step apply via the bot chosen in Settings.
 * Claude reads the application over MCP and can mark Sent / add notes.
 * Grok gets a local apply packet folder + a prompt that names that path.
 */
export function ApplyWithBot({
  applicationId,
  postingUrl,
  company,
  role,
  title,
  location,
  salary,
  experience,
  hasResume,
  hasLetter,
  applyBot,
  grokBotId,
  connectorOn,
  snapshotUrl,
  botInstructions,
  promptContext,
}: {
  applicationId: string;
  postingUrl: string;
  company: string;
  role: string;
  title: string;
  /** Profile location for standard answers (e.g. "Lisbon, Portugal"). */
  location?: string;
  /** Target / posting salary when known. */
  salary?: string;
  /** Short experience line from the profile. */
  experience?: string;
  hasResume: boolean;
  hasLetter: boolean;
  applyBot: ApplyBot;
  grokBotId: string | null;
  /** Claude connector enabled in Settings. */
  connectorOn: boolean;
  snapshotUrl?: string | null;
  botInstructions?: string;
  promptContext?: Partial<DriveApplyPromptInput>;
}) {
  const [manualPrompt, setManualPrompt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [handoff, setHandoff] = useState<{ href: string; prompt: string; dir: string } | null>(null);
  const url = postingUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    return (
      <Button variant="secondary" size="sm" aria-disabled="true" title="Add a link to the posting first.">
        Apply with bot
      </Button>
    );
  }

  const hasDocuments = hasResume || hasLetter;
  const baseAnswers = {
    location: (location ?? "").trim(),
    expectedSalary: (salary ?? "").trim(),
    experience: (experience ?? "").trim(),
  };

  const botLabel = APPLY_BOTS.find(bot => bot.value === applyBot)!.label;
  const sharedPrompt = () => driveApplyPrompt({
    ...promptContext, applicationId, snapshotUrl: snapshotUrl || undefined,
    company, jobTitle: role || title, postingUrl: url,
    applicationUrl: `${window.location.origin}/applications/${encodeURIComponent(applicationId)}`,
    botName: botLabel, botInstructions,
  });
  const copyForBot = () => {
    const prompt = sharedPrompt();
    setManualPrompt(prompt);
    void copyText(prompt).then(copied => toast(copied
      ? `Prompt copied for ${botLabel}. Paste it into that bot. Drive is tried first, then ZIP; review answers before submitting.`
      : "Couldn’t copy automatically. Copy the apply prompt below."));
  };

  const openClaude = () => {
    if (!connectorOn) {
      toast("Turn on the Claude connector in Settings → MCP connector first, so Claude can read this application and update its status.");
      return;
    }
    let href = claudeApplyUrl({
      applicationId,
      company,
      role,
      title,
      postingUrl: url,
      salary,
      answers: baseAnswers,
    });
    const chat = new URL(href);
    const fullPrompt = snapshotUrl ? sharedPrompt() : appendBotPreferences(chat.searchParams.get("q") ?? "", botLabel, botInstructions);
    // The clipboard carries the complete handoff; keep browser chat links bounded.
    chat.searchParams.set("q", fullPrompt.length > 3000
      ? `Prepare HireMe application ${applicationId}: ${role || title} at ${company}. Posting: ${url}. ${snapshotUrl ? `Drive packet: ${snapshotUrl}.` : "Read this application using the HireMe connector."} I will paste the full handoff prompt. Show every answer and never submit without my explicit OK.`
      : fullPrompt);
    if (fullPrompt.length > 3000) setManualPrompt(fullPrompt);
    href = chat.toString();
    openHref(href);
    void copyText(fullPrompt).then((copied) => {
      toast(
        (copied ? "Prompt copied and Claude opened." : "Opened Claude.") +
          " It will load this application from HireMe. Approve before submit; when you confirm it was sent, Claude marks it Sent here.",
      );
    });
  };

  const openGrok = () => {
    if (snapshotUrl) {
      copyForBot();
      openHref(grokBotApplyUrl(grokBotId, `Use this job's Drive packet: ${snapshotUrl}. Follow the full prompt on my clipboard; ZIP fallback is included. Never submit without my OK.`));
      return;
    }
    void (async () => {
      setBusy(true);
      setHandoff(null);
      try {
        toast("Preparing resume, cover letter and apply instructions…");
        const packet = await prepareGrokApplyPacket({ id: applicationId });
        if (!packet.ok) {
          toast(packet.error);
          return;
        }
        const archiveName = packet.data.archiveName || `hireme-apply-${applicationId}.zip`;
        if (packet.data.downloadUrl) {
          const response = await fetch(packet.data.downloadUrl);
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.error || "Couldn’t download the apply packet. Try again.");
          }
          saveFile(await response.blob(), archiveName);
        }
        const { href } = grokApplyHandoff({
          postingUrl: url,
          company,
          role,
          title,
          hasDocuments,
          packetDir: packet.data.dir,
          salary,
          answers: {
            location: packet.data.answers?.location || baseAnswers.location,
            expectedSalary: packet.data.answers?.expectedSalary || baseAnswers.expectedSalary,
            experience: packet.data.answers?.experience || baseAnswers.experience,
          },
          grokBotId,
        });
        const prompt = sharedPrompt();
        if (packet.data.downloadUrl) {
          const extraction = `First find ${archiveName} in my Downloads folder (or ask where I saved it). Extract the ZIP into ~/Documents/hireme/apply/; it contains the ${applicationId} folder. Read the extracted files at ${packet.data.dir}. If you cannot access my local files, ask me to attach the ZIP or PDFs. This is a draft packet, not approval to submit.\n\n`;
          // Include extraction instructions in both the clipboard and bot deep link.
          const ready = grokApplyHandoff({
            postingUrl: url, company, role, title, hasDocuments,
            packetDir: `${archiveName} in Downloads; extract into ~/Documents/hireme/apply/ before reading ${packet.data.dir}`,
            salary, answers: packet.data.answers, grokBotId,
          });
          setHandoff({ href: ready.href, prompt: extraction + prompt, dir: packet.data.dir });
          toast("Packet download ready. Save the ZIP, then open Grok Bot below.");
        } else {
          openHref(href);
          const copied = await copyText(`The ZIP fallback packet is already extracted at ${packet.data.dir}; use that local folder directly.\n\n${prompt}`);
          toast((copied ? "Prompt copied. " : "") + `Materials are in ${packet.data.dir}. After you confirm submit, mark Sent in HireMe.`);
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : "Couldn’t prepare the apply packet. Try again.");
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="secondary" size="sm" disabled={busy} onClick={applyBot === "claude" ? openClaude : applyBot === "grok" ? openGrok : copyForBot}>
        {busy ? "Preparing packet…" : "Apply with bot"}
      </Button>
      {manualPrompt && <details><summary>Apply prompt</summary><textarea aria-label="Apply prompt" readOnly value={manualPrompt} className="min-h-48 w-full" /></details>}
      {handoff && (
        <div className="max-w-md space-y-2 text-sm">
          <p>Save the downloaded ZIP. Grok can extract it to <code>{handoff.dir}</code> and read the PDFs and instructions. If Grok cannot access local files, attach the ZIP in its chat.</p>
          <Button variant="secondary" size="sm" onClick={() => {
            openHref(handoff.href);
            void copyText(handoff.prompt).then((copied) => toast(copied
              ? "Prompt copied. Paste it into Grok Bot. Review every answer before submitting."
              : "Couldn’t copy the prompt. Copy the instructions below into Grok Bot."));
          }}>Open Grok Bot</Button>
          <details><summary>Apply prompt</summary><textarea aria-label="Apply prompt" readOnly value={handoff.prompt} className="w-full min-h-48" /></details>
        </div>
      )}
    </div>
  );
}
