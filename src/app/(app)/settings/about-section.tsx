"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { checkUpdates } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

export type AboutFacts = { label: string; value: string }[];

type Check = { status: "idle" } | { status: "checking" } | { status: "latest" } | { status: "newer"; version: string; url: string } | { status: "unknown" };

/** Settings → About (E10-9, SET-12): facts about this install, and an update check that runs only when asked. */
export function AboutSection({ facts, usagePingHost }: { facts: AboutFacts; usagePingHost: string }) {
  const [check, setCheck] = useState<Check>({ status: "idle" });

  const run = async () => {
    setCheck({ status: "checking" });
    const result = await checkUpdates({});
    setCheck(result.ok ? result.data : { status: "unknown" });
  };

  return (
    <>
      <SettingsSectionIntro title="About this install">Free and open source. No accounts, no subscriptions.</SettingsSectionIntro>
      <Card padding="none" className="px-7 py-2">
        <dl>
          {facts.map(({ label, value }) => (
            <div key={label} className="flex justify-between gap-4 border-t border-line py-3.5 text-sm first:border-t-0">
              <dt className="text-muted">{label}</dt>
              <dd className="text-right font-mono text-[13px] [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="flex flex-wrap items-center gap-3.5">
        <Button variant="secondary" aria-disabled={check.status === "checking" || undefined} onClick={() => check.status !== "checking" && void run()}>
          {check.status === "checking" ? "Checking…" : "Check for updates"}
        </Button>
        <p role="status" className="text-control text-muted">
          {check.status === "latest" && "You're on the latest version."}
          {check.status === "unknown" && "Couldn't check for updates right now."}
          {check.status === "newer" && (
            <>
              Version {check.version} is available.{" "}
              <a href={check.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline underline-offset-2">
                See what&apos;s new{" "}
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </>
          )}
        </p>
      </div>
      <p className="text-meta text-muted">Checking asks GitHub for the latest release and sends nothing about you or this install.</p>
      <p className="text-meta text-muted">
        While the usage ping is on, the server sends {usagePingHost} this install&apos;s ID and the version number once on each day Dossier is used, so the project knows how many installs are in use and how often. The ID is random and says nothing about you. Nothing else is sent. Set <code className="font-mono">DOSSIER_TELEMETRY=off</code> to stop it. To have the rows already kept for this install removed too, send its ID to{" "}
        <a href="mailto:dossier.app@pm.me" className="font-medium text-ink underline underline-offset-2">
          dossier.app@pm.me
        </a>
        , with the ping switched off so nothing new arrives; you get a confirmation once they&apos;re gone.
      </p>
    </>
  );
}
