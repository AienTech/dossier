"use client";

import { useId, useState } from "react";

import { ArbeitsagenturNote } from "@/components/arbeitsagentur-note";
import { KeyField } from "@/components/key-field";
import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toggle } from "@/components/ui/toggle";
import { JOB_SOURCES, JSEARCH_HOSTS, type JobSource, type JSearchHost } from "@/lib/job-search/search";
import { FREEHIRE_URL, JSEARCH_KEY_URLS, SOURCE_INFO, type JobSearchSettingsView } from "@/lib/job-search/sources";
import { cn } from "@/lib/cn";

import { saveJobSearchDetails, saveJobSource, saveJobSourceKey, testJobSource } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

type Connection =
  | { status: "untested" }
  | { status: "testing" }
  | { status: "connected"; seconds: number }
  | { status: "failed"; message: string };

/** A test's key: the source, and for JSearch the host whose key it tried. */
type TestKey = JobSource | `JSEARCH:${JSearchHost}`;

/**
 * Settings → Job search (E14-4): which sources Find jobs searches, and their
 * keys. Any number can be on; a search asks each, one after another. Each
 * field saves on its own; a key is saved when you leave its field and never
 * shown again. The Bundesagentur für Arbeit is saved only once its note is
 * accepted, and isn't offered when the server turns it off (#223).
 */
export function JobSearchSection({ initial }: { initial: JobSearchSettingsView }) {
  const track = useTrackSave();
  const [view, setView] = useState(initial);
  const [appId, setAppId] = useState(initial.adzuna.appId);
  const [connections, setConnections] = useState<Partial<Record<TestKey, Connection>>>({});
  // The BA turned on, waiting for its note to be accepted before it's saved.
  const [baPending, setBaPending] = useState(false);

  // Any change to a source means its last test no longer counts.
  const changed = (source: JobSource) =>
    setConnections((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(source))));

  const apply = (result: Awaited<ReturnType<typeof saveJobSource>>) => {
    if (result.ok) setView(result.data);
    return result.ok;
  };

  const turn = async (source: JobSource, on: boolean) => {
    changed(source);
    if (source === "ARBEITSAGENTUR") {
      setBaPending(on && !view.arbeitsagentur.acceptedAt);
      if (on && !view.arbeitsagentur.acceptedAt) return;
    }
    setView((current) => ({ ...current, sources: on ? JOB_SOURCES.filter((entry) => entry === source || current.sources.includes(entry)) : current.sources.filter((entry) => entry !== source) }));
    apply(toastResult(await track(saveJobSource({ source, on }))));
  };

  const acceptArbeitsagentur = async () => {
    const ok = apply(toastResult(await track(saveJobSource({ source: "ARBEITSAGENTUR", on: true, accepted: true }))));
    if (ok) setBaPending(false);
    return ok;
  };
  const offered = view.arbeitsagentur.offered ? JOB_SOURCES : JOB_SOURCES.filter((source) => source !== "ARBEITSAGENTUR");
  const isOn = (source: JobSource) => view.sources.includes(source) || (source === "ARBEITSAGENTUR" && baPending);

  const chooseHost = async (host: JSearchHost) => {
    setView((current) => ({ ...current, jsearch: { ...current.jsearch, host } }));
    changed("JSEARCH");
    apply(toastResult(await track(saveJobSearchDetails({ jsearchHost: host }))));
  };

  const saveAppId = async () => {
    if (appId.trim() === view.adzuna.appId) return;
    changed("ADZUNA");
    apply(toastResult(await track(saveJobSearchDetails({ adzunaAppId: appId }))));
  };

  const saveKey = async (keySource: "JSEARCH" | "ADZUNA", change: { action: "set"; value: string } | { action: "clear" }, host?: JSearchHost) => {
    changed(keySource);
    return apply(toastResult(await track(saveJobSourceKey({ source: keySource, host, change }))));
  };

  const test = async (source: JobSource, host?: JSearchHost) => {
    const key: TestKey = host ? `JSEARCH:${host}` : source;
    if (connections[key]?.status === "testing") return;
    const set = (connection: Connection) => setConnections((current) => ({ ...current, [key]: connection }));
    set({ status: "testing" });
    const result = await testJobSource({ source, host });
    if (!result.ok) set({ status: "failed", message: result.error });
    else if (result.data.connected) set({ status: "connected", seconds: result.data.seconds });
    else set({ status: "failed", message: result.data.message });
  };

  const testButton = (source: JobSource, host?: JSearchHost, label = "Test connection") => {
    const connection = connections[(host ? `JSEARCH:${host}` : source) as TestKey] ?? { status: "untested" };
    return (
      <div className="flex flex-wrap items-center gap-3.5 pt-1">
        <Button variant="secondary" size="sm" onClick={() => void test(source, host)} disabled={connection.status === "testing"}>
          {connection.status === "testing" ? "Testing…" : label}
        </Button>
        <ConnectionStatus connection={connection} source={source} />
      </div>
    );
  };

  return (
    <>
      <SettingsSectionIntro title="Job search">
        Where Find jobs looks for postings. Turn on as many sources as you like: a search asks each one, one after another, and each keeps its own key.
      </SettingsSectionIntro>

      {view.sources.length > 0 && (
        <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          Your searches (keywords, place and filters) go to {view.sources.map((source) => SOURCE_INFO[source].name).join(", ")}. Nothing from your profile does.
        </p>
      )}

      {offered.map((source) => (
        <Card key={source} className="flex flex-col gap-5">
          <Toggle
            label={SOURCE_INFO[source].name}
            description={`${SOURCE_INFO[source].description} · ${SOURCE_INFO[source].tag}`}
            checked={isOn(source)}
            onCheckedChange={(on) => void turn(source, on)}
          />
          {isOn(source) && source === "JSEARCH" && (
            <>
              <div className="grid grid-cols-1 gap-x-[18px] gap-y-5 sm:grid-cols-2">
                {JSEARCH_HOSTS.map((host) => (
                  <div key={host} className="flex flex-col gap-2.5">
                    <KeyField
                      label={`${HOST_NAMES[host]} key`}
                      keyState={view.jsearch.keyStates[host]}
                      envName="DOSSIER_JSEARCH_KEY"
                      getKey={{ href: JSEARCH_KEY_URLS[host], text: host === "rapidapi" ? "JSearch on RapidAPI" : "OpenWeb Ninja" }}
                      onSave={(change) => saveKey("JSEARCH", change, host)}
                    />
                    {view.jsearch.keyStates[host] !== "none" && testButton("JSEARCH", host, `Test ${HOST_NAMES[host]}`)}
                  </div>
                ))}
              </div>
              <HostChoice host={view.jsearch.host} onChange={(host) => void chooseHost(host)} />
            </>
          )}
          {isOn(source) && source === "ADZUNA" && (
            <>
              <div className="grid grid-cols-1 gap-x-[18px] gap-y-5 sm:grid-cols-2">
                <Input
                  label="App ID"
                  value={appId}
                  spellCheck={false}
                  autoComplete="off"
                  inputClassName="font-mono text-[13.5px]"
                  onChange={(event) => setAppId(event.target.value)}
                  onBlur={() => void saveAppId()}
                />
                <KeyField
                  label="App key"
                  keyState={view.adzuna.keyState}
                  envName="DOSSIER_ADZUNA_KEY"
                  getKey={{ href: SOURCE_INFO.ADZUNA.keyUrl!, text: "Adzuna's developer site" }}
                  onSave={(change) => saveKey("ADZUNA", change)}
                />
              </div>
              {testButton("ADZUNA")}
            </>
          )}
          {isOn(source) && source === "ARBEITSAGENTUR" && (
            <>
              <ArbeitsagenturNote accepted={Boolean(view.arbeitsagentur.acceptedAt)} onAccept={acceptArbeitsagentur} />
              <p className="text-sm text-muted">No key needed. The job agent doesn&apos;t search this source.</p>
              {view.arbeitsagentur.acceptedAt && testButton("ARBEITSAGENTUR")}
            </>
          )}
          {isOn(source) && source === "FREEHIRE" && (
            <>
              <p className="text-sm text-muted">
                {view.freehire.host === new URL(FREEHIRE_URL).host
                  ? `No key needed. Dossier searches FreeHire's public catalogue at ${view.freehire.host}.`
                  : `No key needed. Dossier searches your own FreeHire at ${view.freehire.host}.`}
              </p>
              {testButton("FREEHIRE")}
            </>
          )}
        </Card>
      ))}
    </>
  );
}

const HOST_NAMES: Record<JSearchHost, string> = { openwebninja: "OpenWeb Ninja", rapidapi: "RapidAPI" };

/** Which JSearch host is asked first; the other, with a key, takes over when the first refuses its key or is used up. */
function HostChoice({ host, onChange }: { host: JSearchHost; onChange: (host: JSearchHost) => void }) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-[7px]">
      <span id={labelId} className="text-label text-muted">
        Ask first
      </span>
      <SegmentedControl<JSearchHost>
        aria-labelledby={labelId}
        size="sm"
        options={[
          { value: "openwebninja", label: "OpenWeb Ninja" },
          { value: "rapidapi", label: "RapidAPI" },
        ]}
        value={host}
        onValueChange={onChange}
      />
    </div>
  );
}

function ConnectionStatus({ connection, source }: { connection: Connection; source: JobSource }) {
  const [dot, text, message] =
    connection.status === "connected"
      ? ["bg-success", "text-success", `Connected · ${SOURCE_INFO[source].name} answered in ${connection.seconds.toLocaleString("en-US")} s`]
      : connection.status === "failed"
        ? ["bg-error", "text-error", connection.message]
        : connection.status === "testing"
          ? ["bg-status-offer", "text-muted", "Sending a small search…"]
          : ["bg-faint", "text-muted", source === "JSEARCH" ? "Not tested since your last change · a test uses one search from your plan" : "Not tested since your last change"];
  return (
    <p role="status" className={cn("flex items-center gap-2 text-control", text)}>
      <span aria-hidden className={cn("size-2 flex-none rounded-full", dot)} />
      {message}
    </p>
  );
}
