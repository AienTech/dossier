import { z } from "zod";

import { PostingSource } from "@/generated/prisma/enums";
import { daysBetween, formatShortCalendarDate } from "@/lib/dates";
import type { PostingFit } from "@/lib/fit";

import { countryCodeFor } from "./countries";
import { SOURCE_INFO } from "./sources";

// Job search (E14): what a search asks for and what a posting looks like,
// whichever source answers. Shared by the server and the Find jobs screen.
// In this code "job" already means a background task (src/lib/jobs), so a
// job ad is a "posting".

/** The job sources Dossier can search (E14-1 to E14-3, FreeHire), in the order Settings lists them; one is chosen there. */
export const JOB_SOURCES = [PostingSource.JSEARCH, PostingSource.ADZUNA, PostingSource.FREEHIRE, PostingSource.ARBEITSAGENTUR] as const;
/** A job source: every PostingSource but STARTUP, which is the job agent's name for a candidate from Startups. */
export type JobSource = Exclude<PostingSource, "STARTUP">;
export const isJobSource = (source: PostingSource): source is JobSource => source !== PostingSource.STARTUP;
/** A stored source that must be a job source: Find jobs' postings and searches never hold a startup. */
export function asJobSource(source: PostingSource): JobSource {
  if (!isJobSource(source)) throw new Error("A startup isn't a job source.");
  return source;
}

/** Where a JSearch key comes from: OpenWeb Ninja directly, or the RapidAPI marketplace. */
export const JSEARCH_HOSTS = ["openwebninja", "rapidapi"] as const;
export type JSearchHost = (typeof JSEARCH_HOSTS)[number];

/** How far from the place to look, in km (E14-6). */
export const RADII_KM = [10, 25, 50, 100, 200] as const;
export type RadiusKm = (typeof RADII_KM)[number];
export const DEFAULT_RADIUS_KM: RadiusKm = 25;

/** How recent the postings must be, with the days each choice allows. */
export const POSTED_WITHIN = [
  { value: "any", label: "Any time", days: null },
  { value: "day", label: "Past day", days: 1 },
  { value: "3days", label: "Past 3 days", days: 3 },
  { value: "week", label: "Past week", days: 7 },
  { value: "month", label: "Past month", days: 30 },
] as const;
export type PostedWithin = (typeof POSTED_WITHIN)[number]["value"];
const POSTED_VALUES = POSTED_WITHIN.map((option) => option.value) as [PostedWithin, ...PostedWithin[]];

/** One search, as every source gets it. */
export const searchQuerySchema = z.object({
  keywords: z.string().trim().max(200),
  /** A city or region; empty searches the whole country. */
  place: z.string().trim().max(200),
  /** ISO 3166-1 alpha-2 in lower case, e.g. "de"; empty until one is chosen. */
  country: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^([a-z]{2})?$/),
  radiusKm: z.literal(RADII_KM),
  remoteOnly: z.boolean(),
  postedWithin: z.enum(POSTED_VALUES),
});
export type SearchQuery = z.output<typeof searchQuerySchema>;

export const EMPTY_QUERY: SearchQuery = {
  keywords: "",
  place: "",
  country: "",
  radiusKm: DEFAULT_RADIUS_KM,
  remoteOnly: false,
  postedWithin: "any",
};

/** A posting as a source found it, in one shape for every source. */
export const foundPostingSchema = z.object({
  source: z.enum(JOB_SOURCES),
  /** The source's own id for it. */
  externalId: z.string().min(1).max(500),
  title: z.string().max(500),
  company: z.string().max(300),
  place: z.string().max(300),
  /** Null when the source doesn't say. */
  remote: z.boolean().nullable(),
  /** As the source writes it, e.g. "EUR 60,000–75,000 a year"; empty when there's none. */
  salary: z.string().max(200),
  postedAt: z.iso.datetime().nullable(),
  /** Where to read it or apply: always http(s), or empty. */
  url: z
    .string()
    .max(2000)
    .refine((url) => url === "" || safeLink(url) !== "", "Not a web address."),
  /** Where the source found it, e.g. "LinkedIn"; empty when it's the source's own. */
  via: z.string().max(100),
  /** Plain text. */
  description: z.string().max(100_000),
  /** False while the description is only the start of the posting. */
  complete: z.boolean(),
});
export type FoundPosting = z.output<typeof foundPostingSchema>;

/** A posting kept with a search: also the other sources that found the same job. */
export const storedPostingSchema = foundPostingSchema.extend({ alsoOn: z.array(z.enum(JOB_SOURCES)).catch([]).default([]) });
export type StoredPosting = z.output<typeof storedPostingSchema>;

/** How one source answered a search: what it found, what to ask for its next page (null on its last), or what went wrong. */
export const sourceResultSchema = z.object({
  source: z.enum(JOB_SOURCES),
  found: z.number().int().min(0),
  next: z.string().nullable(),
  problem: z.string().nullable(),
});
export type SourceResult = z.output<typeof sourceResultSchema>;

/** A page of results, and what to ask for the next page (null on the last one). */
export type SearchPage = { postings: FoundPosting[]; next: string | null };

/** Where a posting stands for the user (E14-5). */
export type PostingState = {
  /** Its row, when it's stored. */
  postingId: string | null;
  saved: boolean;
  dismissed: boolean;
  /** The application made from it, or from the same link before Find jobs. */
  applicationId: string | null;
  /** How well it fits the profile, once it's scored (#208). */
  score: PostingFit | null;
};

/** A posting as Find jobs shows it; `alsoOn` names other sources that found the same job. */
export type ShownPosting = FoundPosting & { state: PostingState; alsoOn?: JobSource[] };

/** What went wrong with a search, in words for the screen (E14-6). */
export type SearchProblem = { ok: false; problem: "off" | "not-accepted" | "no-country" | "no-key" | "key" | "quota" | "country" | "unavailable" | "changed"; message: string };

/** What "Show more" gives the screen: more postings and how each source answered, or what went wrong. */
export type SearchOutcome = { ok: true; postings: ShownPosting[]; results: SourceResult[] } | SearchProblem;

/** A search kept with what it found (E14-10), as Find jobs opens it. */
export type StoredSearch = {
  id: string;
  sources: JobSource[];
  query: SearchQuery;
  /** "today at 14:32", "yesterday at 09:05", "on Thu 1 Oct at 18:20", in the user's time zone. */
  ranAt: string;
  postings: ShownPosting[];
  results: SourceResult[];
};

/** Whether any source has another page. */
export const hasMore = (results: readonly SourceResult[]) => results.some((result) => result.next !== null);

/** A search in the Past searches list, grouped by the day it ran. */
export type PastSearchDay = {
  /** "Today", "Yesterday" or "Thu 1 Oct". */
  day: string;
  searches: { id: string; sources: JobSource[]; query: SearchQuery; found: number; time: string }[];
};

/** "product designer · Hamburg, 25 km · Remote only · Past week": a search in a line, without the km when no source has a radius. */
export function describeSearch(query: SearchQuery, countryName: string, sources?: readonly JobSource[] | null): string {
  const noRadius = sources && sources.length > 0 && sources.every((source) => !SOURCE_INFO[source].radius);
  const where = query.place ? (noRadius ? query.place : `${query.place}, ${query.radiusKm} km`) : countryName;
  const posted = POSTED_WITHIN.find((option) => option.value === query.postedWithin);
  return [query.keywords, where, query.remoteOnly ? "Remote only" : "", posted && posted.value !== "any" ? posted.label : ""].filter(Boolean).join(" · ");
}

/** Identifies a posting across searches. */
export const postingKey = (posting: { source: PostingSource; externalId: string }) => `${posting.source}:${posting.externalId}`;

/** A link from a source, kept only when it's a web address, so it can't run script as an href. */
export function safeLink(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

// Query parameters that only say where a click came from.
const TRACKING = /^(utm_.*|trackingid|refid|ref|src|source|from|gh_src|lever-source|trk|trkinfo|sid|campaign|cmp|mc_cid|mc_eid|fbclid|gclid|msclkid|originalsubdomain)$/i;

/**
 * A link reduced to what identifies the page, so a posting found in Find
 * jobs matches an application made from the same link: host without "www.",
 * path, and the query without tracking parameters. "" when it isn't a link.
 */
export function linkKey(link: string): string {
  try {
    const url = new URL(link.trim());
    const params = [...url.searchParams].filter(([name]) => !TRACKING.test(name)).sort(([a], [b]) => a.localeCompare(b));
    const query = new URLSearchParams(params).toString();
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${query ? `?${query}` : ""}`;
  } catch {
    return "";
  }
}

// ─── In the URL ──────────────────────────────────────────────────────────────
// /jobs?q=designer&where=Hamburg&country=de&radius=25&remote=1&posted=week, so
// Back, a reload or a bookmark show the same search.

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** The search in the URL, or null when there's none (no keywords). */
export function queryFromParams(params: Record<string, string | string[] | undefined>): SearchQuery | null {
  const keywords = one(params.q).trim();
  if (!keywords) return null;
  const radius = Number(one(params.radius));
  const posted = POSTED_VALUES.find((value) => value === one(params.posted));
  const country = one(params.country).trim().toLowerCase();
  return {
    keywords: keywords.slice(0, 200),
    place: one(params.where).trim().slice(0, 200),
    country: /^[a-z]{2}$/.test(country) ? country : "",
    radiusKm: RADII_KM.find((km) => km === radius) ?? DEFAULT_RADIUS_KM,
    remoteOnly: one(params.remote) === "1",
    postedWithin: posted ?? "any",
  };
}

/** Find jobs' views: the search, past searches (E14-10), and the postings kept from them (E14-7). */
export type JobsView = "search" | "history" | "saved" | "dismissed";

export function viewFromParams(params: Record<string, string | string[] | undefined>): JobsView {
  const view = one(params.view);
  return view === "history" || view === "saved" || view === "dismissed" ? view : "search";
}

export const viewHref = (view: "history" | "saved" | "dismissed") => `/jobs?view=${view}`;

/** A kept search on Find jobs (E14-10). */
export const searchRunHref = (id: string) => `/jobs?search=${encodeURIComponent(id)}`;

/** The Find jobs URL for a search. */
export function searchHref(query: SearchQuery): string {
  const params = new URLSearchParams({ q: query.keywords });
  if (query.place) params.set("where", query.place);
  if (query.country) params.set("country", query.country);
  if (query.radiusKm !== DEFAULT_RADIUS_KM) params.set("radius", String(query.radiusKm));
  if (query.remoteOnly) params.set("remote", "1");
  if (query.postedWithin !== "any") params.set("posted", query.postedWithin);
  return `/jobs?${params.toString()}`;
}

// ─── For the screen ──────────────────────────────────────────────────────────

type Role = { role: string; current: boolean; startYear: number | null; startMonth: number | null; endYear: number | null; endMonth: number | null };

const monthOf = (year: number | null, month: number | null) => (year === null ? -1 : year * 12 + (month ?? 1));

/** The role to search for first: the current one, else the one that ended last; "" without any. */
export function latestRole(experience: readonly Role[]): string {
  const named = experience.filter((entry) => entry.role.trim());
  const latest = named.toSorted(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      monthOf(b.endYear, b.endMonth) - monthOf(a.endYear, a.endMonth) ||
      monthOf(b.startYear, b.startMonth) - monthOf(a.startYear, a.startMonth),
  )[0];
  return latest?.role.trim() ?? "";
}

/** The first search on Find jobs (E14-6): that role, in the profile's city and country. */
export function defaultSearch({ role, city, country }: { role: string; city: string; country: string }): SearchQuery {
  return { ...EMPTY_QUERY, keywords: role.trim().slice(0, 200), place: city.trim().slice(0, 200), country: countryCodeFor(country) };
}

/** "Today", "Yesterday", "3 days ago", "2 weeks ago", or the date for older postings; "" without a date. */
export function postedAgo(postedAt: string | null, now: Date): string {
  if (!postedAt) return "";
  const posted = new Date(postedAt);
  const days = daysBetween(posted, now, "UTC");
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 31) return days < 14 ? "1 week ago" : `${Math.floor(days / 7)} weeks ago`;
  return formatShortCalendarDate(posted, now);
}

// ─── As a posting to paste ───────────────────────────────────────────────────

/**
 * The posting as New application gets it (E14-8): company and title, the
 * facts, then the description, laid out like a fetched posting
 * (src/lib/posting-fetch.ts).
 */
export function postingText(posting: Pick<FoundPosting, "title" | "company" | "place" | "remote" | "salary" | "description">): string {
  const facts = [posting.place, posting.remote ? "Remote" : "", posting.salary].filter(Boolean);
  return [[posting.company, posting.title].filter(Boolean).join(": "), facts.join(" · "), posting.description.trim()]
    .filter(Boolean)
    .join("\n\n");
}
