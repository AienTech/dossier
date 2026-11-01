"use client";

import Link from "next/link";
import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import type { Country } from "@/lib/job-search/countries";
import type { AgentSearch } from "@/lib/agent/searches";
import { searchHref, type JobSource, type SearchQuery } from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import type { JobSourceBudgets } from "@/lib/settings";
import type { Scorer } from "@/lib/scoring/scorers";

import { deleteAgentSearch, moveAgentSearch, saveAgentSearch, saveAgentSettings } from "../agent/actions";
import { RemoteOnlyField, SearchFields, type SearchFieldErrors } from "../jobs/search-fields";
import { SETTINGS_SECTIONS, settingsSectionHref, type SettingsSectionId } from "./sections";
import { SettingsSectionIntro } from "./settings-screen";

export type AgentSettings = {
  enabled: boolean;
  hour: number;
  minScore: number;
  maxScores: number;
  maxDrafts: number;
  autoDraft: boolean;
  maxSearches: number;
  maxPages: number;
  budgets: JobSourceBudgets;
  startups: boolean;
  startupMinMatch: number;
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MIN_SCORES = [50, 55, 60, 65, 70, 75, 80, 85, 90];
const SCORE_COUNTS = Array.from({ length: 30 }, (_, index) => index + 1);
const DRAFT_COUNTS = Array.from({ length: 11 }, (_, index) => index);
const SEARCH_LIMITS = Array.from({ length: 10 }, (_, index) => index + 1);
const PAGE_COUNTS = [1, 2, 3, 4, 5];
const STARTUP_MATCHES = [0, 20, 30, 40, 50, 60, 70, 80];
const BUDGET_COUNTS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50, 100];
const clock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Settings → Job agent (E16-7): whether it runs, its saved searches, when,
 * how much a run may do, and how many requests each source may get. Each
 * change saves at once; a search when Save is pressed.
 */
export function AgentSection({
  initial,
  searches: initialSearches,
  starter,
  sources,
  scoring,
  countries,
  timeZone,
}: {
  initial: AgentSettings;
  searches: AgentSearch[];
  /** What a new search starts from: the last one in Find jobs, else the profile's. */
  starter: SearchQuery;
  /** The sources in Settings → Job search the agent searches: all but the Bundesagentur für Arbeit. */
  sources: JobSource[];
  /** What scores the postings (Settings → Scoring), and whether it's set up. */
  scoring: { scorer: Scorer; ready: boolean };
  countries: readonly Country[];
  /** The user's time zone, which the hour is in. */
  timeZone: string;
}) {
  const track = useTrackSave();
  const [settings, setSettings] = useState(initial);
  const [searches, setSearches] = useState(initialSearches);
  const [adding, setAdding] = useState(false);

  const change = (next: Partial<AgentSettings>) => {
    const previous = settings;
    setSettings({ ...settings, ...next });
    void track(saveAgentSettings(next)).then((result) => {
      if (!toastResult(result).ok) setSettings(previous);
    });
  };

  const saved = async (result: Awaited<ReturnType<typeof saveAgentSearch>>) => {
    if (!toastResult(result).ok || !result.ok) return false;
    setSearches(result.data);
    return true;
  };

  const requestsPerRun = (source: JobSource) =>
    settings.maxPages * searches.filter((search) => search.enabled && (search.sources.length === 0 || search.sources.includes(source))).length;

  return (
    <>
      <SettingsSectionIntro title="Job agent">
        Once a day it runs your saved searches, scores the new postings against your profile, and keeps the best on the Agent screen. It never sends or applies.
      </SettingsSectionIntro>

      {sources.length === 0 ? (
        // It searches on its own, which the BA's terms forbid most clearly (#223).
        <SetupNote
          before="The agent searches the sources you choose in "
          section="jobs"
          after=", other than the Bundesagentur für Arbeit. Choose JSearch, Adzuna or FreeHire first."
        />
      ) : scoring.ready ? null : scoring.scorer === "JEV" ? (
        <SetupNote before="The agent scores postings with Jev, which needs your TypeSafe key in " section="scoring" after="." />
      ) : (
        <SetupNote before="The agent scores postings with the AI provider in " section="ai" after=", which isn't set up yet. Choose one first." />
      )}

      <Card padding="none" className="px-7 py-4">
        <Toggle
          label="Run the job agent"
          description={
            settings.enabled
              ? `On. It runs once a day after ${clock(settings.hour)} your time (${timeZone}), and you can run it any time on the Agent screen.`
              : "Off. Nothing is searched or scored until it's on."
          }
          checked={settings.enabled}
          onCheckedChange={(enabled) => change({ enabled })}
        />
      </Card>

      <Card padding="none" className="flex flex-col gap-4 px-7 py-[26px]">
        <div className="flex flex-col gap-1">
          <h3 className="text-field font-medium">What it looks for</h3>
          <p className="text-meta text-muted">
            Searches as in{" "}
            <Link href={searchHref(starter)} className="font-medium text-ink underline underline-offset-2">
              Find jobs
            </Link>
            , each on the sources you tick, or on all of them. Postings you saved, dismissed or applied for there are left out. Scoring takes from each search in turn.
          </p>
        </div>
        {searches.map((search, index) => (
          <SearchEditor
            key={search.id}
            initial={search}
            sources={sources}
            countries={countries}
            first={index === 0}
            last={index === searches.length - 1}
            onSave={async (value) => saved(await track(saveAgentSearch({ ...value, id: search.id })))}
            onDelete={async () => void saved(await track(deleteAgentSearch({ id: search.id })))}
            onMove={async (by) => void saved(await track(moveAgentSearch({ id: search.id, by })))}
          />
        ))}
        <Toggle
          label="Include Startups"
          description={
            settings.startups
              ? `On. Each run also takes startups from Startups that match at least ${settings.startupMinMatch} of 100, refreshing them once a day, and scores them with the postings.`
              : "Off. Startups stays a list of its own."
          }
          checked={settings.startups}
          onCheckedChange={(startups) => change({ startups })}
        />
        {settings.startups && (
          <Select
            label="Startups' match, at least"
            className="sm:max-w-[240px]"
            value={String(settings.startupMinMatch)}
            onChange={(event) => change({ startupMinMatch: Number(event.target.value) })}
          >
            {[...new Set([...STARTUP_MATCHES, settings.startupMinMatch])].sort((a, b) => a - b).map((score) => (
              <option key={score} value={score}>
                {score} of 100
              </option>
            ))}
          </Select>
        )}
        {adding ? (
          <SearchEditor
            initial={{ id: "", name: "", query: starter, sources: [], enabled: true }}
            sources={sources}
            countries={countries}
            onSave={async (value) => {
              const ok = await saved(await track(saveAgentSearch(value)));
              if (ok) setAdding(false);
              return ok;
            }}
            onDelete={async () => setAdding(false)}
          />
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            disabled={searches.length >= settings.maxSearches}
            onClick={() => setAdding(true)}
          >
            Add a search
          </Button>
        )}
      </Card>

      <Card padding="none" className="grid gap-x-[18px] gap-y-5 px-7 py-[26px] sm:grid-cols-2">
        <Select label="Runs after" hint={`Your time (${timeZone})`} value={String(settings.hour)} onChange={(event) => change({ hour: Number(event.target.value) })}>
          {HOURS.map((hour) => (
            <option key={hour} value={hour}>
              {clock(hour)}
            </option>
          ))}
        </Select>
        <Select
          label="Minimum score"
          hint="Postings scored lower stay out of the queue."
          value={String(settings.minScore)}
          onChange={(event) => change({ minScore: Number(event.target.value) })}
        >
          {[...new Set([...MIN_SCORES, settings.minScore])].sort((a, b) => a - b).map((score) => (
            <option key={score} value={score}>
              {score} of 100
            </option>
          ))}
        </Select>
        <Select label="Postings scored per run" value={String(settings.maxScores)} onChange={(event) => change({ maxScores: Number(event.target.value) })}>
          {SCORE_COUNTS.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </Select>
        <Select
          label="Drafts per run, at most"
          value={String(settings.maxDrafts)}
          disabled={!settings.autoDraft}
          hint={settings.autoDraft ? undefined : "Turn on Prepare drafts on its own first"}
          onChange={(event) => change({ maxDrafts: Number(event.target.value) })}
        >
          {DRAFT_COUNTS.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </Select>
        <Toggle
          className="sm:col-span-2"
          label="Prepare drafts on its own"
          description={
            settings.autoDraft
              ? `For the best new postings of each run, up to ${plural(settings.maxDrafts, "draft", "drafts")}: a tailored resume and cover letter, waiting for your review.`
              : "Off. You choose which postings get a draft with Prepare draft."
          }
          checked={settings.autoDraft}
          onCheckedChange={(autoDraft) => change({ autoDraft })}
        />
      </Card>

      <Card padding="none" className="grid gap-x-[18px] gap-y-5 px-7 py-[26px] sm:grid-cols-2">
        <Select label="Saved searches, at most" value={String(settings.maxSearches)} onChange={(event) => change({ maxSearches: Number(event.target.value) })}>
          {SEARCH_LIMITS.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </Select>
        <Select
          label="Pages per search and source"
          hint="Each page is one request; a page holds 10 to 25 postings."
          value={String(settings.maxPages)}
          onChange={(event) => change({ maxPages: Number(event.target.value) })}
        >
          {PAGE_COUNTS.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </Select>
        {sources.map((source) => {
          const budget = settings.budgets[source as keyof JobSourceBudgets];
          return (
            <Select
              key={source}
              label={`${SOURCE_INFO[source].name} requests per 24 hours`}
              hint={`A run sends it up to ${plural(requestsPerRun(source), "request", "requests")}.`}
              value={budget === null ? "" : String(budget)}
              onChange={(event) =>
                change({ budgets: { ...settings.budgets, [source]: event.target.value === "" ? null : Number(event.target.value) } })
              }
            >
              <option value="">No limit</option>
              {[...new Set([...BUDGET_COUNTS, ...(budget === null ? [] : [budget])])].sort((x, y) => x - y).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </Select>
          );
        })}
      </Card>

      <p className="text-meta text-muted">
        One run a day, and Run now whenever a source has requests left. Each run scores up to {plural(settings.maxScores, "posting", "postings")}
        {settings.autoDraft ? ` and prepares up to ${plural(settings.maxDrafts, "draft", "drafts")}` : ""}. Scoring and drafts go to your AI provider with your profile, as a new application does; the job sources only get the searches.
      </p>
    </>
  );
}

/** One saved search: its name, query, sources and switch, saved with Save. */
function SearchEditor({
  initial,
  sources,
  countries,
  first = true,
  last = true,
  onSave,
  onDelete,
  onMove,
}: {
  initial: AgentSearch;
  sources: JobSource[];
  countries: readonly Country[];
  first?: boolean;
  last?: boolean;
  onSave: (search: Omit<AgentSearch, "id">) => Promise<boolean>;
  onDelete: () => Promise<void>;
  onMove?: (by: -1 | 1) => Promise<void>;
}) {
  const [search, setSearch] = useState(initial);
  const [errors, setErrors] = useState<SearchFieldErrors>({});
  const [dirty, setDirty] = useState(!initial.id);
  const update = (patch: Partial<AgentSearch>) => {
    setErrors({});
    setDirty(true);
    setSearch((current) => ({ ...current, ...patch }));
  };
  const setQuery = (patch: Partial<SearchQuery>) => update({ query: { ...search.query, ...patch } });
  const asked = search.sources.length === 0 ? sources : sources.filter((source) => search.sources.includes(source));

  const save = async () => {
    const problems = {
      keywords: search.query.keywords.trim() ? undefined : "Type what the search should look for.",
      country: search.query.country ? undefined : "Choose a country.",
    };
    setErrors(problems);
    if (problems.keywords || problems.country) return;
    if (await onSave({ name: search.name, query: search.query, sources: search.sources, enabled: search.enabled })) setDirty(false);
  };

  const toggleSource = (source: JobSource, on: boolean) => {
    const current = search.sources.length === 0 ? sources : search.sources;
    const next = on ? [...current, source] : current.filter((entry) => entry !== source);
    // All of them is the same as none named: new sources are asked too.
    update({ sources: next.length === sources.length ? [] : next });
  };

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line-card p-5">
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-2">
        <Input
          className="sm:col-span-2"
          label="Name"
          value={search.name}
          placeholder="Optional, e.g. Tech lead roles"
          onChange={(event) => update({ name: event.target.value })}
        />
        <SearchFields value={search.query} onChange={setQuery} sources={asked} countries={countries} errors={errors} />
        <div className="sm:col-span-2">
          <RemoteOnlyField value={search.query} onChange={setQuery} sources={asked} />
        </div>
      </div>
      {sources.length > 1 && (
        <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
          <legend className="mb-2 text-label text-muted">Sources</legend>
          {sources.map((source) => (
            <Checkbox
              key={source}
              label={SOURCE_INFO[source].name}
              checked={search.sources.length === 0 || search.sources.includes(source)}
              onChange={(event) => toggleSource(source, event.target.checked)}
            />
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        <Checkbox label="Run this search" checked={search.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
        <span className="flex-1" />
        {onMove && !first && (
          <Button variant="text" size="sm" onClick={() => void onMove(-1)}>
            Move up
          </Button>
        )}
        {onMove && !last && (
          <Button variant="text" size="sm" onClick={() => void onMove(1)}>
            Move down
          </Button>
        )}
        <Button variant="text" size="sm" onClick={() => void onDelete()}>
          {initial.id ? "Delete" : "Cancel"}
        </Button>
        <Button size="sm" disabled={!dirty} onClick={() => void save()}>
          Save search
        </Button>
      </div>
    </div>
  );
}

/** What the agent still needs, with a link to the section that sets it up. */
function SetupNote({ before, section, after }: { before: string; section: SettingsSectionId; after: string }) {
  return (
    <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
      {before}
      <Link href={settingsSectionHref(section)} className="font-medium text-warning underline underline-offset-2">
        Settings → {SETTINGS_SECTIONS.find((entry) => entry.id === section)?.label}
      </Link>
      {after}
    </p>
  );
}
