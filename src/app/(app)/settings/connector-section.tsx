"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { copyText } from "@/lib/copy-text";

import { addConnectorRedirect, disconnectApps, removeConnectorRedirect, setConnector } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

const LINK = "font-medium text-ink underline underline-offset-2";

/**
 * Settings → MCP connector (#221, #281): HireMe as a connector for Claude
 * and other MCP apps, off until it's turned on here. Then it shows the
 * address to add in an app, Claude's steps, the other apps allowed to sign
 * in, and Disconnect all apps, which signs every one of them out.
 */
export function ConnectorSection({
  initial,
  address,
  inDesktopApp = false,
}: {
  initial: { on: boolean; redirects: string[] };
  address: string;
  /** On this computer, in the desktop app: an app's approval page opens in the browser, which the app signs in (#365). */
  inDesktopApp?: boolean;
}) {
  const track = useTrackSave();
  const [on, setOn] = useState(initial.on);
  const [redirects, setRedirects] = useState(initial.redirects);
  const [draft, setDraft] = useState("");
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(address);
  const publicHttps = address.startsWith("https://");

  const turn = async (next: boolean) => {
    setOn(next);
    const result = toastResult(await track(setConnector({ on: next })));
    if (!result.ok) setOn(!next);
  };

  const copy = async () => toast((await copyText(address)) ? "Address copied." : "Couldn't copy it. Select the address and copy it instead.");

  const addRedirect = async () => {
    const uri = draft.trim();
    if (!uri) return;
    const result = toastResult(await track(addConnectorRedirect({ uri })));
    if (!result.ok) return;
    setRedirects(result.data.redirects);
    setDraft("");
  };

  const removeRedirect = async (uri: string) => {
    const result = toastResult(await track(removeConnectorRedirect({ uri })));
    if (result.ok) setRedirects(result.data.redirects);
  };

  return (
    <>
      <SettingsSectionIntro title="MCP connector">
        Use HireMe from OpenBot, Cursor, ChatGPT, Claude, or another app that speaks MCP. Connected apps can search and save jobs, track applied jobs and rejections,
        edit application details, archive and restore cards, and read your dashboard. They can also read your profile and write application drafts. Access is controlled per app. Sending, permanent deletion and final submission handoffs require your approval in HireMe.
      </SettingsSectionIntro>

      {inDesktopApp && (
        <p className="text-meta text-muted">
          On this computer, an app asks you to allow it in your browser. When it does, choose Help → Sign in my browser in this window, and the
          browser carries on.
        </p>
      )}

      <a href="/delegations" className="mb-4 block underline">Manage app permissions and action approvals</a>
      <Card padding="none" className="px-7 py-4">
        <Toggle
          label="Let apps connect"
          description={
            on
              ? "On. Apps connect at the address below, once you've signed in to HireMe and allowed them."
              : "Off. The connector's addresses aren't open on this server."
          }
          checked={on}
          onCheckedChange={(checked) => void turn(checked)}
        />
      </Card>

      {on && (
        <>
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-[7px]">
              <span className="text-label text-muted">Address to add in an app</span>
              <div className="flex flex-wrap items-center gap-3">
                <code className="min-w-0 flex-1 rounded-control border border-line-input bg-input px-3 py-2 font-mono text-[13px] [overflow-wrap:anywhere]">
                  {address}
                </code>
                <Button variant="secondary" size="sm" onClick={() => void copy()}>
                  Copy
                </Button>
              </div>
            </div>
            <h3 className="text-control font-medium">In OpenBot</h3>
            <p className="text-sm text-pretty">
              Add a custom HTTP MCP server named HireMe in OpenBot, paste the address above, and sign in.
              First add OpenBot&apos;s callback address under Other apps below. Current desktop builds use{" "}
              <code className="font-mono text-label">openbot://mcp-auth</code>;
              if OpenBot shows a different callback address, add that exact address instead. Its permissions are saved separately from ChatGPT and other connected apps.
            </p>
            <h3 className="text-control font-medium">In Cursor</h3>
            <p className="text-sm text-pretty">Add this server to Cursor&apos;s MCP configuration, then connect and sign in:</p>
            <pre className="overflow-x-auto rounded-control bg-input p-3 font-mono text-[13px]">{JSON.stringify({ mcpServers: { hireme: { url: address } } }, null, 2)}</pre>
            <h3 className="text-control font-medium">In ChatGPT</h3>
            <p className="text-sm text-pretty">
              Add a custom MCP server with this address and OAuth authentication. Add the exact callback address shown by ChatGPT under Other apps,
              then connect and allow HireMe. A cloud client needs a public HTTPS address.
            </p>
            <h3 className="text-control font-medium">With DeepSeek</h3>
            <p className="text-sm text-pretty">
              Use DeepSeek in an MCP-capable client, such as OpenBot. Connect HireMe in that client; a model API alone does not run MCP tools.
            </p>
            <h3 className="text-control font-medium">In Claude</h3>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-pretty">
              <li>
                Open <strong>Settings → Connectors</strong> and choose <strong>Add custom connector</strong>.
              </li>
              <li>
                Name it <strong>HireMe</strong>, paste the address and press <strong>Add</strong>, then <strong>Connect</strong>.
              </li>
              <li>
                Claude opens HireMe: sign in if it asks, check what Claude may do, and press <strong>Allow</strong>.
              </li>
            </ol>
            <p className="text-meta text-muted">
              In Claude&apos;s command-line app: <code className="font-mono text-label">claude mcp add --transport http hireme {address}</code>, then{" "}
              <code className="font-mono text-label">/mcp</code> to sign in.
            </p>
            {!publicHttps && (
              <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
                {local ? "This is a local address. " : "This address isn't HTTPS. "}
                Claude on the web, Desktop and mobile, and apps in the cloud such as n8n Cloud, reach HireMe from their own servers, so they need a public HTTPS
                address (set <code className="font-mono text-label">HIREME_PUBLIC_URL</code> if HireMe is reached at another one). Claude&apos;s command-line
                app on the computer HireMe runs on can use this one.
              </p>
            )}
          </Card>

          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h3 className="text-control font-medium">Other apps</h3>
              <p className="text-sm text-pretty text-muted">
                After you allow an app, HireMe sends you back to the app&apos;s own callback address. Claude&apos;s are known; for OpenBot, Cursor, ChatGPT or another app, add its address here
                exactly as the app shows it (n8n calls it the OAuth Redirect URL). Whoever uses an app you add can read and change your HireMe through it.
              </p>
            </div>
            {redirects.length > 0 && (
              <ul aria-label="Apps' callback addresses" className="flex flex-col gap-2">
                {redirects.map((uri) => (
                  <li key={uri} className="flex flex-wrap items-center gap-3">
                    <code className="min-w-0 flex-1 font-mono text-[13px] [overflow-wrap:anywhere]">{uri}</code>
                    <Button variant="text" size="sm" onClick={() => void removeRedirect(uri)}>
                      Remove <span className="sr-only">{uri}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <Input
                label="Callback address"
                className="min-w-0 flex-1"
                inputClassName="font-mono text-[13.5px]"
                placeholder="https://your-app.example/oauth/callback"
                spellCheck={false}
                autoComplete="off"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addRedirect();
                  }
                }}
              />
              <Button variant="secondary" onClick={() => void addRedirect()}>
                Add
              </Button>
            </div>
          </Card>

          <Card className="flex flex-col gap-3 text-sm text-pretty">
            <p>
              What an app reads through the connector goes to whoever runs it. For Claude, that&apos;s Anthropic, with your Claude account, as anything in a chat:
              your profile without its contact details, the postings and applications it works on, and your searches. Private notes, contacts and the letter&apos;s sender
              and signature stay out of baseline reads. You can explicitly enable private reads for an app in Manage app permissions.{" "}
              <a href="https://github.com/shahzadafridi/HireMe/wiki/Connecting-Claude" target="_blank" rel="noopener noreferrer" className={LINK}>
                Connecting Claude
              </a>{" "}
              has the details.
            </p>
            <p className="text-muted">
              Without an AI model of HireMe&apos;s own, New application and Score in Find jobs hand the work to a new Claude chat, which saves it here through the
              connector.
            </p>
            <div>
              <Button variant="secondary" onClick={() => void track(disconnectApps({})).then(toastResult)}>
                Disconnect all apps
              </Button>
              <p className="mt-2 text-meta text-muted">Signs Claude and every other app out. Changing your password or HIREME_SECRET does too.</p>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
