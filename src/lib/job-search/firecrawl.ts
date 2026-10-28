import "server-only";

import { z } from "zod";

import { fetchPosting } from "@/lib/posting-fetch";

import type { JobSourceAdapter, RequestContext, SourceCredentials } from "./adapter";
import { countryName } from "./countries";
import { jobSearchError } from "./errors";
import { requestJson } from "./http";
import { fromMarkdown, plainText } from "./text";
import { safeLink, type FoundPosting, type PostedWithin, type SearchPage, type SearchQuery } from "./search";

// Firecrawl (E14-7, this fork): one web search across the open web, the way
// a person googling "data engineer jobs in Bengaluru" would, rather than one
// job board's own index. It's the answer to "I don't want to miss postings
// that only show up on Naukri, or Greenhouse, or a company's own site" —
// without Dossier maintaining a scraper per site, which breaks the moment a
// site's markup changes and risks its terms of use the way the Bundesagentur
// für Arbeit source already owns up to (sources.ts). A plain web search
// biased toward the job boards below covers LinkedIn, Indeed, Naukri,
// Glassdoor, Monster and the common applicant-tracking systems (Greenhouse,
// Lever, Ashby, Workday, SmartRecruiters) in one request.
//
// Trade-offs, on purpose:
// - The search only returns a title, a link and a short snippet — not a
//   separate company field the way JSearch and Adzuna's APIs do. The
//   company is pulled from the job board's own URL shape when the result is
//   on an applicant-tracking system (reliable: the company is in the path),
//   else guessed from the title's own wording (best-effort; see
//   parseResultTitle below). Either way it can be "", which is honest rather
//   than invented, and isBlockedPosting() (blocklist.ts) still catches a
//   blocked company named in the title or snippet even when the company
//   field comes up empty.
// - The full posting is fetched like Adzuna's (details() below, reusing
//   src/lib/posting-fetch.ts) rather than spent on Firecrawl's own scrape
//   for every result: a search is one Firecrawl credit, a scrape is more,
//   and the guarded fetcher already does this safely for every other
//   source.
// - Firecrawl's /search has no paging cursor, so Dossier asks for one
//   generous page (PAGE_SIZE) and never offers "Show more" for this source
//   (next is always null).

const BASE = "https://api.firecrawl.dev/v2";
const SEARCH_PATH = "/search";
const PAGE_SIZE = 30;

/** Job boards and applicant-tracking systems the search is biased toward, besides whatever else the open web turns up. */
export const JOB_BOARD_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "naukri.com",
  "glassdoor.com",
  "monster.com",
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "wellfound.com",
] as const;

/** Google's `tbs` date range closest to each "posted within" choice; Firecrawl passes it straight through. There's no 3-day unit, so that choice widens to a week rather than narrowing to a day, favouring a posting shown over one missed. */
const TBS: Partial<Record<PostedWithin, string>> = { day: "qdr:d", "3days": "qdr:w", week: "qdr:w", month: "qdr:m" };

const resultSchema = z.object({
  url: z.string().min(1),
  title: z.string().nullish().catch(null),
  description: z.string().nullish().catch(null),
  markdown: z.string().nullish().catch(null),
});
type Result = z.output<typeof resultSchema>;

const responseSchema = z.object({ success: z.boolean(), data: z.object({ web: z.array(z.unknown()).nullish().catch([]) }).nullish().catch({ web: [] }) });

/**
 * The company from an applicant-tracking system's own URL shape, which
 * names it in the path or the subdomain: reliable where the search gives
 * one, because the company owns that part of the address.
 *
 *   https://job-boards.greenhouse.io/acmecorp/jobs/1234        -> "Acmecorp"
 *   https://jobs.lever.co/acmecorp/...                         -> "Acmecorp"
 *   https://jobs.ashbyhq.com/acmecorp/...                      -> "Acmecorp"
 *   https://acmecorp.wd1.myworkdayjobs.com/en-US/careers/job/… -> "Acmecorp"
 *   https://jobs.smartrecruiters.com/Acmecorp/...              -> "Acmecorp"
 */
export function companyFromAtsUrl(url: string): string {
  const parsed = URL.canParse(url) ? new URL(url) : null;
  if (!parsed) return "";
  const host = parsed.hostname.toLowerCase();
  const segment = (index: number) => parsed.pathname.split("/").filter(Boolean)[index] ?? "";
  if (/(^|\.)(job-boards|jobs|boards)\.greenhouse\.io$/.test(host)) return titleCase(segment(0));
  if (/(^|\.)jobs\.lever\.co$/.test(host)) return titleCase(segment(0));
  if (/(^|\.)jobs\.ashbyhq\.com$/.test(host)) return titleCase(segment(0));
  if (/(^|\.)jobs\.smartrecruiters\.com$/.test(host)) return titleCase(segment(0));
  const workday = /^([a-z0-9-]+)\.[a-z0-9.]*myworkdayjobs\.com$/.exec(host);
  if (workday) return titleCase(workday[1]);
  return "";
}

function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1));
}

/** Suffixes a job board appends to its own page titles, trimmed before anything else is parsed out. */
const SITE_SUFFIX = /\s*[|·]\s*(LinkedIn|Indeed(\.com)?|Naukri(\.com)?|Glassdoor|Monster(\.com)?|Greenhouse|Lever|Ashby|Workday|SmartRecruiters)\s*$/i;

/**
 * Best-effort split of an aggregator's page title into a role and a
 * company, from the handful of phrasings LinkedIn, Indeed, Naukri and
 * Glassdoor write their titles in ("Acme Corp hiring Data Engineer in
 * Bengaluru", "Data Engineer - Acme Corp - Bengaluru"). Falls back to the
 * whole title with no company, rather than guessing wrong — isBlockedPosting
 * still has the full title and description to check against.
 */
export function parseResultTitle(raw: string): { title: string; company: string } {
  const bare = plainText(raw).replace(SITE_SUFFIX, "").trim();
  const hiring = /^(.+?)\s+(?:is\s+)?hiring\b\s*(?:for\s+)?(?:an?\s+)?(.+)$/i.exec(bare);
  if (hiring) {
    const title = hiring[2].replace(/\s+\bin\b\s+[^,-]+(,.*)?$/i, "").trim();
    return { title: title || bare, company: hiring[1].trim() };
  }
  const parts = bare.split(/\s+[-–—]\s+/).filter(Boolean);
  if (parts.length >= 2) return { title: parts[0].trim(), company: parts[parts.length - 1].trim() };
  return { title: bare, company: "" };
}

export function postingFromResult(result: Result): FoundPosting {
  const url = safeLink(result.url);
  const parsed = parseResultTitle(result.title ?? "");
  const company = companyFromAtsUrl(url) || parsed.company;
  const description = fromMarkdown(result.markdown) || plainText(result.description).slice(0, 100_000);
  return {
    source: "FIRECRAWL",
    // Firecrawl doesn't hand back an id of its own; the link is the posting's stable identity.
    externalId: url.slice(0, 500) || result.url.slice(0, 500),
    title: parsed.title.slice(0, 500),
    company: company.slice(0, 300),
    place: "",
    remote: null,
    salary: "",
    postedAt: null,
    url: url.slice(0, 2000),
    via: "",
    description,
    complete: false,
  };
}

/** "data engineer jobs in Bengaluru remote (site:linkedin.com OR site:indeed.com OR …)": a query the open web, not one API, answers. */
function searchText(query: SearchQuery): string {
  const where = query.place ? ` in ${query.place}` : "";
  const remote = query.remoteOnly ? " remote" : "";
  const sites = JOB_BOARD_DOMAINS.map((domain) => `site:${domain}`).join(" OR ");
  return `${query.keywords} jobs${where}${remote} (${sites})`;
}

async function searchPage(query: SearchQuery, { key }: SourceCredentials["FIRECRAWL"], _next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const url = new URL(`${context.baseUrl ?? BASE}${SEARCH_PATH}`);
  const body: Record<string, unknown> = {
    query: searchText(query).slice(0, 500),
    limit: PAGE_SIZE,
    country: (query.country || "us").toUpperCase(),
    location: query.place || countryName(query.country || "us"),
  };
  const tbs = TBS[query.postedWithin];
  if (tbs) body.tbs = tbs;

  const answer = responseSchema.safeParse(
    await requestJson("FIRECRAWL", url, { method: "POST", body, headers: { authorization: `Bearer ${key}` }, signal: context.signal }),
  );
  if (!answer.success || answer.data.success === false) throw jobSearchError("changed", "FIRECRAWL", { detail: `${url.pathname}: unexpected answer` });

  const seen = new Set<string>();
  const postings: FoundPosting[] = [];
  for (const item of answer.data.data?.web ?? []) {
    const result = resultSchema.safeParse(item);
    if (!result.success) continue;
    const posting = postingFromResult(result.data);
    if (!posting.url || !posting.title || seen.has(posting.externalId)) continue;
    seen.add(posting.externalId);
    postings.push(posting);
  }
  // No cursor in Firecrawl's /search: one page is what there is.
  return { postings, next: null };
}

export const firecrawl: JobSourceAdapter<"FIRECRAWL"> = {
  source: "FIRECRAWL",
  search: searchPage,
  // The search only gives a snippet; the rest comes from the posting's own page, exactly as Adzuna's does.
  details: async (posting) => {
    if (!posting.url) return null;
    const page = await fetchPosting(posting.url);
    return page.ok ? page.text : null;
  },
  test: async (credentials, context) => {
    await searchPage({ keywords: "developer", place: "", country: "us", radiusKm: 25, remoteOnly: false, postedWithin: "any" }, credentials, null, context);
  },
};
