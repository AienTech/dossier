"use client";

import { useEffect, useState, useTransition } from "react";

import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DiscovererCompany, DiscovererProgress } from "@/lib/job-search/discoverer-host";
import { cn } from "@/lib/cn";

import {
  addWatchlistCompany,
  listWatchlistCompanies,
  pauseWatchlistScrape,
  removeWatchlistCompany,
  startWatchlistScrape,
  watchlistScrapeStatus,
} from "./actions";

const ATS_OPTIONS = ["greenhouse", "ashby", "lever", "smartrecruiters", "workable", "bamboohr", "breezy", "personio", "teamtailor"] as const;

/**
 * Settings → Job search → company watchlist for the local discoverer:
 * add/remove boards, refresh with a progress bar, resume after failure.
 */
export function WatchlistSection({ host }: { host: string }) {
  const [pending, startTransition] = useTransition();
  const [companies, setCompanies] = useState<DiscovererCompany[]>([]);
  const [progress, setProgress] = useState<DiscovererProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ats, setAts] = useState<string>("greenhouse");
  const [slug, setSlug] = useState("");
  const [url, setUrl] = useState("");

  const load = () =>
    startTransition(async () => {
      const listed = await listWatchlistCompanies({});
      if (!listed.ok) {
        setError(listed.error);
        return;
      }
      setError(null);
      setCompanies(listed.data);
      const status = await watchlistScrapeStatus({});
      if (status.ok) setProgress(status.data);
    });

  useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      void watchlistScrapeStatus({}).then((status) => {
        if (status.ok) setProgress(status.data);
      });
    }, 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount + poll only
  }, [host]);

  const add = () =>
    startTransition(async () => {
      const result = toastResult(
        await addWatchlistCompany({
          name,
          ats: url.trim() ? undefined : ats,
          slug: url.trim() ? undefined : slug,
          url: url.trim() || undefined,
        }),
      );
      if (!result.ok) return;
      setName("");
      setSlug("");
      setUrl("");
      setCompanies(result.data);
      toast("Company added to the watchlist.");
    });

  const remove = (id: string) =>
    startTransition(async () => {
      const result = toastResult(await removeWatchlistCompany({ id }));
      if (!result.ok) return;
      setCompanies(result.data);
    });

  const refresh = (resume: boolean) =>
    startTransition(async () => {
      const result = toastResult(await startWatchlistScrape({ resume, forceNew: !resume }));
      if (result.ok) setProgress(result.data);
    });

  const pause = () =>
    startTransition(async () => {
      const result = toastResult(await pauseWatchlistScrape({}));
      if (result.ok) setProgress(result.data);
    });

  const running = progress?.status === "running";
  const percent = progress?.percent ?? 0;

  return (
    <Card padding="none" className="flex flex-col gap-4 px-7 py-5">
      <div>
        <h3 className="font-serif text-section">Company watchlist</h3>
        <p className="mt-1 text-meta text-muted">
          Boards the local discoverer at {host} scrapes into a durable inventory. Progress is saved per company — Resume continues where a run stopped.
        </p>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {progress && (
        <div className="flex flex-col gap-2 rounded-control border border-line-card bg-paper/60 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-control">
            <span className="font-medium capitalize">{progress.status}</span>
            <span className="text-muted">
              {progress.done}/{progress.total}
              {progress.failed ? ` · ${progress.failed} failed` : ""} · {percent}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-meta text-muted">{progress.current ? `Now: ${progress.current}` : progress.message}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="secondary" size="sm" disabled={pending || running} onClick={() => refresh(false)}>
              Refresh all
            </Button>
            <Button variant="secondary" size="sm" disabled={pending || running || !progress.can_resume} onClick={() => refresh(true)}>
              Resume
            </Button>
            <Button variant="secondary" size="sm" disabled={pending || !running} onClick={() => pause()}>
              Pause
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-label text-muted">
          Company name
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme" />
        </label>
        <label className="flex flex-col gap-1.5 text-label text-muted">
          ATS
          <select
            className="h-10 rounded-control border border-line-input bg-input px-3 text-field text-ink shadow-control outline-none focus-visible:ring-2 focus-visible:ring-focus"
            value={ats}
            onChange={(event) => setAts(event.target.value)}
            disabled={Boolean(url.trim())}
          >
            {ATS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-label text-muted">
          Board slug
          <Input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="acme" disabled={Boolean(url.trim())} />
        </label>
        <label className="flex flex-col gap-1.5 text-label text-muted sm:col-span-2">
          Or careers URL
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://careers.example.com/jobs" />
          <span className="text-meta font-normal text-muted">
            Use this when there&apos;s no board in the ATS list — paste the company careers / jobs page. The discoverer detects Greenhouse, Ashby, Lever, and the others from the URL. Fully custom career sites (no supported ATS behind them) won&apos;t scrape into the inventory; search boards or paste a posting instead.
          </span>
        </label>
      </div>
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending || !name.trim() || (!url.trim() && !slug.trim())}
          onClick={() => add()}
        >
          Add company
        </Button>
      </div>

      {companies.length === 0 ? (
        <p className="text-meta text-muted">No companies yet. Add a Greenhouse / Ashby / Lever board above.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {companies.map((company) => {
            const row = progress?.companies.find((item) => item.id === company.id);
            return (
              <li key={company.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{company.name}</p>
                  <p className="truncate text-meta text-muted">
                    {company.url || `${company.ats}/${company.slug}`}
                    {row ? ` · ${row.status}${row.jobs ? ` · ${row.jobs} jobs` : ""}${row.error ? ` · ${row.error}` : ""}` : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "size-2 flex-none rounded-full",
                    row?.status === "done" ? "bg-success" : row?.status === "failed" ? "bg-error" : row?.status === "running" ? "bg-status-offer" : "bg-faint",
                  )}
                  aria-hidden
                />
                <Button variant="danger-text" size="sm" disabled={pending} onClick={() => remove(company.id)}>
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
