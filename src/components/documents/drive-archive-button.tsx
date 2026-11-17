"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { APPLY_BOTS, EMPTY_BOT_NOTES, type ApplyBot, type ApplyBotNotes } from "@/lib/application-bots";
import { Button, buttonClassName } from "@/components/ui/button";
import { toast } from "@/components/toast";
import { driveApplyPrompt, type DriveApplyPromptInput } from "@/lib/drive-handoff";
import { getDriveAutoSync, startDriveAutoSync } from "@/lib/google/drive-sync-actions";
import type { DriveSyncView } from "@/lib/google/drive-sync";
import { botLaunchMessage, botLaunchUrl } from "@/lib/bot-launch";

const never = () => () => {};
const browserOrigin = () => window.location.origin;
const serverOrigin = () => "";

export function DriveArchiveButton({ applicationId, snapshotUrl, defaultBot = "grok", botNotes = EMPTY_BOT_NOTES,
  driveSyncKey, initialDriveSnapshot, autoSave = true, grokBotId = null, openbotLaunchMode = "clipboard", openbotAgentName = "Job Manager", grokLaunchMode = "app-link", grokAgentName = "Job Finder", openbotAppName = "", grokAppName = "", packetPassword, ...context
}: Omit<DriveApplyPromptInput, "snapshotUrl" | "applicationUrl"> & {
  snapshotUrl?: string | null; defaultBot?: ApplyBot; botNotes?: ApplyBotNotes;
  driveSyncKey?: string; initialDriveSnapshot?: string; autoSave?: boolean; grokBotId?: string | null; openbotLaunchMode?: "clipboard" | "mac-helper"; openbotAgentName?: string; grokLaunchMode?: "app-link" | "mac-helper"; grokAgentName?: string; openbotAppName?: string; grokAppName?: string;
}) {
  const [chosenBot, setChosenBot] = useState<ApplyBot | null>(null);
  const [sync, setSync] = useState<DriveSyncView>(() => initialDriveSnapshot && driveSyncKey ? { status: "ready", url: initialDriveSnapshot, sourceHash: driveSyncKey } : { status: "idle" });
  const [retry, setRetry] = useState(0);
  const origin = useSyncExternalStore(never, browserOrigin, serverOrigin);
  const bot = chosenBot ?? defaultBot;
  const botLabel = APPLY_BOTS.find(entry => entry.value === bot)!.label;
  const url = driveSyncKey ? sync.status === "ready" && sync.sourceHash === driveSyncKey ? sync.url : undefined : snapshotUrl || undefined;
  const settingsUrl = `/settings?section=agent&application=${encodeURIComponent(applicationId)}#bot-${bot}`;
  const prompt = driveApplyPrompt({ ...context, applicationId, snapshotUrl: url, botName: botLabel,
    botInstructions: botNotes[bot], applicationUrl: `${origin}/applications/${encodeURIComponent(applicationId)}`, packetPassword });

  useEffect(() => {
    if (!driveSyncKey || !autoSave) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async (start: boolean) => {
      try {
        const result = start ? await startDriveAutoSync({ id: applicationId, retry: retry > 0 }) : await getDriveAutoSync({ id: applicationId });
        if (stopped) return;
        if (!result.ok) { setSync({ status: "error", error: result.error }); return; }
        setSync(result.data);
        if (result.data.status === "syncing") timer = setTimeout(() => void check(false), 2500);
        else if (result.data.status === "idle" || (result.data.status === "ready" && result.data.sourceHash !== driveSyncKey)) {
          timer = setTimeout(() => void check(true), 2500);
        }
      } catch {
        if (!stopped) setSync({ status: "error", error: "Drive auto-save could not be checked. Retry or review Google settings." });
      }
    };
    timer = setTimeout(() => void check(true), 800);
    return () => { stopped = true; clearTimeout(timer); };
  }, [applicationId, driveSyncKey, autoSave, retry]);

  const opening = botLaunchMessage({ ...context, applicationId, applicationUrl: `${origin}/applications/${encodeURIComponent(applicationId)}`, snapshotUrl: url, botName: botLabel, packetPassword });
  const launchUrl = botLaunchUrl(bot, opening, grokBotId, openbotLaunchMode, openbotAgentName, grokLaunchMode, grokAgentName, openbotAppName, grokAppName);
  const copy = async (launch = false) => {
    let copied: Promise<void> | undefined;
    try { copied = navigator.clipboard?.writeText(prompt); } catch { /* The packet link still works when clipboard access is unavailable. */ }
    try {
      if (!copied) throw new Error("Clipboard unavailable");
      await copied;
      toast(launch && launchUrl?.startsWith("hireme-bot:") ? `Opening ${botLabel} and filling the prompt. Review it before pressing Send.` : launch && launchUrl ? `Opening ${botLabel}. If its message box is empty, paste the copied prompt. Review before sending.` : `Prompt copied for ${botLabel}. Paste it into your bot; review before submitting.`);
    } catch { toast(launch && launchUrl ? "Use the packet links in the bot’s opening message. The full prompt is also available in Bot settings." : "Couldn’t copy the prompt. Open Bot settings to preview and copy it there."); }
  };
  const bannerHost = origin ? document.getElementById("hireme-drive-banner") : null;
  return <>
    {autoSave && sync.status === "error" && bannerHost && createPortal(
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 bg-red-700 px-6 py-3 text-sm text-white">
        <p><strong>Google Drive auto-save failed.</strong> {sync.error} ZIP downloads remain available.</p>
        <div className="flex gap-4"><button type="button" onClick={() => setRetry(value => value + 1)} className="underline">Retry sync</button><Link href="/settings?section=google" className="text-white underline">Google settings</Link></div>
      </div>, bannerHost)}
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <select aria-label="Application bot" value={bot} onChange={event => setChosenBot(event.target.value as ApplyBot)}
        className="h-[34px] w-[160px] shrink-0 rounded-control border border-line-control bg-input px-3 text-sm text-ink shadow-control">
        {APPLY_BOTS.map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
      {launchUrl ? <a href={launchUrl} className={buttonClassName("secondary")} onClick={() => void copy(true)}>Apply with bot</a> : <Button variant="secondary" onClick={() => void copy(true)}>Apply with bot</Button>}
      <Button variant="secondary" onClick={() => void copy()}>Copy bot prompt</Button>
      {bot === "openbot" && openbotLaunchMode === "clipboard" && <span className="text-xs text-muted">Copy mode · enable Mac helper in Bot settings</span>}
      <Link href={settingsUrl} className="text-sm text-muted underline">Bot settings</Link>
      {url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-muted underline">Drive packet</a>}
      {origin && <a href={`${origin}/api/apply-packets/${encodeURIComponent(applicationId)}`} className="text-sm text-muted underline">ZIP packet</a>}
      {sync.status === "syncing" && <span role="status" className="text-xs text-muted">Saving to Drive…</span>}
    </div>
  </>;
}
