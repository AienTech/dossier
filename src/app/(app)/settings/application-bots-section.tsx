"use client";

import Link from "next/link";
import { useState } from "react";
import { useTrackSave } from "@/components/save-tracker";
import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { previewBotPrompt } from "@/lib/bot-prompt-actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAutosave } from "@/hooks/use-autosave";
import { APPLY_BOTS, type ApplyBot, type ApplyBotNotes } from "@/lib/application-bots";
import { saveApplyBot, saveApplyBotNotes, saveApplyBotPromptTemplate, saveGrokBotId, saveOpenbotLaunchMode, saveOpenbotAgentName, saveGrokLaunchMode, saveGrokAgentName, saveGrokAppName, saveOpenbotAppName } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

export function ApplicationBotsSection({ applyBot: initial, grokBotId, notes, promptTemplate = "", openbotLaunchMode = "clipboard", openbotAgentName = "Job Manager", grokLaunchMode = "app-link", grokAgentName = "Job Finder", openbotAppName = "", grokAppName = "", applications = [], selectedApplicationId = "" }: {
  applyBot: ApplyBot; grokBotId: string | null; notes: ApplyBotNotes; promptTemplate?: string; openbotLaunchMode?: "clipboard" | "mac-helper"; openbotAgentName?: string; grokLaunchMode?: "app-link" | "mac-helper"; grokAgentName?: string; openbotAppName?: string; grokAppName?: string;
  applications?: { id: string; company: string; role: string; title: string }[]; selectedApplicationId?: string;
}) {
  const [template, setTemplate] = useState(promptTemplate);
  const [applicationId, setApplicationId] = useState(selectedApplicationId);
  const [selected, setSelected] = useState(initial);
  const [saving, setSaving] = useState(false);
  const track = useTrackSave();
  const { flush: flushTemplate } = useAutosave(template, value => track(saveApplyBotPromptTemplate({ value })));
  const choose = async (value: ApplyBot) => {
    const before = selected;
    setSelected(value); setSaving(true);
    try {
      const result = await track(saveApplyBot({ value }));
      if (!result.ok) { setSelected(before); toast(result.error); }
    } catch { setSelected(before); toast("Couldn’t save the default bot. Try again."); }
    finally { setSaving(false); }
  };
  return (
    <>
      <SettingsSectionIntro title="Application bots">Set up multiple assistants for applying to jobs. Choose a default, save preferences for each bot, and select a bot when copying a job’s handoff prompt.</SettingsSectionIntro>
      <Card className="space-y-4">
        <Select label="Default application bot" value={selected} disabled={saving} onChange={event => void choose(event.target.value as ApplyBot)}>
          {APPLY_BOTS.map(bot => <option key={bot.value} value={bot.value}>{bot.label}</option>)}
        </Select>
        <p className="text-sm text-muted">Bots share the same job context through a private Drive packet, with ZIP download as fallback. They must show every answer before submission and update the existing HireMe card only after confirmed success.</p>
        <div className="flex flex-wrap gap-4 text-sm underline">
          <Link href="/settings?section=connector">Set up MCP access</Link>
          <Link href="/delegations">Manage connected app permissions</Link>
          <Link href="/settings?section=google">Set up Google Drive</Link>
        </div>
      </Card>
      <Card className="space-y-3">
        <h3 className="font-medium">Shared bot prompt template</h3>
        <label className="block space-y-1 text-sm"><span>Prompt template (optional)</span>
          <textarea value={template} onChange={event => setTemplate(event.target.value)} onBlur={flushTemplate} maxLength={10000} rows={7} className="w-full rounded-control border border-line-field bg-input p-3 font-mono text-sm" placeholder="Prepare my application for {{role}} at {{company}}. Show a concise review table.&#10;&#10;Job details: {{job_details}}" />
        </label>
        <p className="text-sm text-muted">One template for all bots. HireMe fills it with the selected application’s details. Leave it empty to use the generated prompt. Required context, file links, approval and board-update instructions are always included.</p>
        <p className="text-xs text-muted">Placeholders: {"{{company}}, {{role}}, {{application_title}}, {{job_details}}, {{location}}, {{salary}}, {{posting_url}}, {{application_url}}, {{application_id}}, {{drive_url}}, {{zip_url}}, {{candidate}}, {{bot}}, {{packet_folder}}"}. Add {"{{default_prompt}}"} where you want the complete generated context; otherwise it is appended.</p>
      </Card>
      <Card className="space-y-3">
        <h3 className="font-medium">Job prompt preview</h3>
        <p className="text-sm text-muted">Choose a job, then preview and copy its complete prompt in the bot’s card below. Edit the bot’s handoff preferences to customise the prompt.</p>
        <Select label="Application for prompt preview" value={applicationId} onChange={event => setApplicationId(event.target.value)}>
          <option value="">Choose an application…</option>
          {applications.map(application => <option key={application.id} value={application.id}>{application.role || application.title || "Application"} · {application.company || "Company"}</option>)}
        </Select>
      </Card>
      {APPLY_BOTS.map(bot => <BotSetup key={bot.value} bot={bot} initialNotes={notes[bot.value]} grokBotId={grokBotId} applicationId={applicationId} template={template} openbotLaunchMode={openbotLaunchMode} openbotAgentName={openbotAgentName} grokLaunchMode={grokLaunchMode} grokAgentName={grokAgentName} openbotAppName={openbotAppName} grokAppName={grokAppName} />)}
    </>
  );
}

function BotSetup({ bot, initialNotes, grokBotId, applicationId, template, openbotLaunchMode, openbotAgentName, grokLaunchMode, grokAgentName, openbotAppName, grokAppName }: { bot: (typeof APPLY_BOTS)[number]; initialNotes: string; grokBotId: string | null; applicationId: string; template: string; openbotLaunchMode: "clipboard" | "mac-helper"; openbotAgentName: string; grokLaunchMode: "app-link" | "mac-helper"; grokAgentName: string; openbotAppName: string; grokAppName: string }) {
  const [preview, setPreview] = useState<{ id: string; notes: string; template: string; prompt: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [notes, setNotes] = useState(initialNotes);
  const [agentName, setAgentName] = useState(bot.value === "grok" ? grokAgentName : openbotAgentName);
  const [appName, setAppName] = useState(bot.value === "grok" ? grokAppName : openbotAppName);
  const [launchMode, setLaunchMode] = useState<"clipboard" | "app-link" | "mac-helper">(bot.value === "grok" ? grokLaunchMode : openbotLaunchMode);
  const [modeSaving, setModeSaving] = useState(false);
  const [botId, setBotId] = useState(grokBotId ?? "");
  const track = useTrackSave();
  const loadPreview = async () => {
    if (!applicationId) return;
    setPreviewing(true);
    try {
      const result = await previewBotPrompt({ id: applicationId, bot: bot.value, notes, template });
      if (result.ok) setPreview({ id: applicationId, notes, template, prompt: result.data.prompt });
      else toast(result.error);
    } catch { toast("Couldn’t load this job’s prompt. Try again."); }
    finally { setPreviewing(false); }
  };
  const currentPreview = preview?.id === applicationId && preview.notes === notes && preview.template === template ? preview : null;
  const { flush: flushAgent } = useAutosave(agentName, value => track(bot.value === "grok" ? saveGrokAgentName({ value }) : saveOpenbotAgentName({ value })));
  const { flush: flushApp } = useAutosave(appName, value => track(bot.value === "grok" ? saveGrokAppName({ value }) : saveOpenbotAppName({ value })));
  const appParam = appName.trim() ? `&app=${encodeURIComponent(appName.trim())}` : "";
  const { flush } = useAutosave(notes, value => track(saveApplyBotNotes({ bot: bot.value, value })));
  const { flush: flushId } = useAutosave(botId, async value => {
    const result = await track(saveGrokBotId({ value }));
    if (result.ok) setBotId(result.data.grokBotId ?? "");
    return result;
  });
  return (
    <Card role="region" aria-labelledby={`bot-${bot.value}`} className="space-y-3">
      <h3 id={`bot-${bot.value}`} className="font-medium">{bot.label}</h3>
      <p className="text-sm text-muted">{bot.description}</p>
      {bot.value === "grok" && <div className="space-y-2">
        <Select label="Grok Bot handoff" value={launchMode} disabled={modeSaving} onChange={event => {
          const before = launchMode; const value = event.target.value as "app-link" | "mac-helper";
          setLaunchMode(value); setModeSaving(true);
          void track(saveGrokLaunchMode({ value })).then(result => { if (!result.ok) { setLaunchMode(before); toast(result.error); } }, () => { setLaunchMode(before); toast("Couldn’t save Grok Bot handoff settings."); }).finally(() => setModeSaving(false));
        }}><option value="app-link">Native app link</option><option value="mac-helper">Open Grok Bot and fill prompt (macOS)</option></Select>
        <p className="text-sm text-muted">For reliable website handoff on this Mac, use the same HireMe Bot Helper as OpenBot. Install it once with <code>bash scripts/macos/install-bot-helper.sh</code> and allow Accessibility. It opens the named bot and pastes the full copied prompt without pressing Send or replacing an existing draft.</p>
        <Input label="Grok Bot agent name" value={agentName} maxLength={100} onChange={event => setAgentName(event.target.value)} onBlur={flushAgent} placeholder="Job Finder" />
        <Input label="Grok Bot app name (optional)" value={appName} maxLength={100} onChange={event => setAppName(event.target.value)} onBlur={flushApp} placeholder="Grok Bot" />
        <p className="text-xs text-muted">Only needed when the app is installed under another name. Leave it empty to open the default Grok Bot, or the copy that is already running.</p>
        <a href={`hireme-bot://grok/apply?agent=${encodeURIComponent(agentName || "Job Finder")}${appParam}&message=HireMe%20connection%20test%20only.%20Do%20not%20send%20this%20test.`} className="text-sm underline">Test Grok Bot helper</a>
        <Input label="Grok Bot id (optional)" value={botId} autoComplete="off" spellCheck={false} placeholder="Bot ID or its shared link" onChange={event => setBotId(event.target.value)} onBlur={flushId} />
        <p className="text-sm text-muted">Use the Bot’s ID, not a conversation ID. Blank uses your primary Bot. Allow the browser to open Grok Bot, and keep its message box empty: Grok preserves any existing draft. Prompt links use a short single-line message; the full prompt is copied as fallback.</p>
      </div>}
      {bot.value === "openbot" && <div className="space-y-2">
        <Select label="OpenBot handoff" value={launchMode} disabled={modeSaving} onChange={event => {
          const before = launchMode; const value = event.target.value as "clipboard" | "mac-helper";
          setLaunchMode(value); setModeSaving(true);
          void track(saveOpenbotLaunchMode({ value })).then(result => { if (!result.ok) { setLaunchMode(before); toast(result.error); } }, () => { setLaunchMode(before); toast("Couldn’t save OpenBot handoff settings."); }).finally(() => setModeSaving(false));
        }}><option value="clipboard">Copy prompt only</option><option value="mac-helper">Open OpenBot and fill prompt (macOS)</option></Select>
        <p className="text-sm text-muted">OpenBot 0.71 has no prompt-prefill link. On your Mac, install the local helper with <code>bash scripts/macos/install-bot-helper.sh</code> from the HireMe checkout, then choose the helper option here. After a one-time macOS Accessibility setup, it opens the named OpenBot agent and fills its composer directly. There is no extra review window. You press Send inside OpenBot. Existing drafts are preserved.</p>
        <Input label="OpenBot agent name" value={agentName} maxLength={100} onChange={event => setAgentName(event.target.value)} onBlur={flushAgent} placeholder="Job Manager" />
        <Input label="OpenBot app name (optional)" value={appName} maxLength={100} onChange={event => setAppName(event.target.value)} onBlur={flushApp} placeholder="OpenBot" />
        <p className="text-xs text-muted">Only needed when the app is installed under another name. Leave it empty to open the default OpenBot, or the copy that is already running.</p>
        <a href={`hireme-bot://openbot/apply?agent=${encodeURIComponent(agentName || "Job Manager")}${appParam}&message=HireMe%20connection%20test%20only.%20Do%20not%20send%20this%20test.`} className="text-sm underline">Test installed helper</a>
        <p className="text-xs text-muted">The agent name must match OpenBot’s sidebar. This works from the live website because the helper runs on your Mac. It uses no OpenBot API token, Local scripts permission, or storage server. Other devices can use Copy bot prompt.</p>
      </div>}
      <label className="block space-y-1 text-sm">
        <span>{bot.label} handoff preferences</span>
        <textarea value={notes} maxLength={2000} onChange={event => setNotes(event.target.value)} onBlur={flush} rows={3} className="w-full rounded-control border border-line-field bg-input p-3" placeholder="Optional workflow or response-format preferences for this bot" />
      </label>
      <Button variant="secondary" size="sm" disabled={!applicationId || previewing} onClick={() => void loadPreview()}>{previewing ? "Loading prompt…" : `Preview ${bot.label} prompt`}</Button>
      {currentPreview && <div className="space-y-2">
        <label className="block space-y-1 text-sm"><span>{bot.label} full application prompt</span><textarea readOnly value={currentPreview.prompt} rows={14} className="max-h-[480px] w-full rounded-control border border-line-field bg-input p-3 font-mono text-xs" /></label>
        <Button variant="secondary" size="sm" onClick={() => void navigator.clipboard.writeText(currentPreview.prompt).then(() => toast("Bot prompt copied."), () => toast("Select the prompt text above and copy it manually."))}>Copy {bot.label} prompt</Button>
      </div>}
      {bot.value === "openbot" && <p className="text-sm text-muted">For board updates, add HireMe as an HTTP MCP server using the connector address in Settings → MCP connector, then sign in. Without MCP, paste the job prompt and use the browser workflow.</p>}
      <p className="text-xs text-muted">Preferences are included only when you choose this bot. Connecting a bot does not change another app’s access or submit a job application.</p>
    </Card>
  );
}
