import "server-only";

import { z } from "zod";

import type { JobSourceAdapter, RequestContext, SourceCredentials } from "./adapter";
import { jobSearchError } from "./errors";
import { requestJson } from "./http";
import { safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "./search";
import { AGENTREACH_DEFAULT_URL } from "./sources";

// AgentReach: social and web search layer covering platforms like LinkedIn,
// Reddit, and the open web without official API subscription fees.
// Translates Dossier's query into an AgentReach search request and returns
// normalized FoundPosting entries.

const maybeText = z.string().nullish().catch(null);
const maybeNumber = z.number().nullish().catch(null);
const maybeBool = z.boolean().nullish().catch(null);

const agentReachItemSchema = z.object({
  id: maybeText,
  externalId: maybeText,
  title: maybeText,
  company: maybeText,
  location: maybeText,
  place: maybeText,
  url: maybeText,
  link: maybeText,
  source: maybeText,
  platform: maybeText,
  via: maybeText,
  remote: maybeBool,
  salary: maybeText,
  salary_min: maybeNumber,
  salary_max: maybeNumber,
  salary_currency: maybeText,
  posted_at: maybeText,
  created_at: maybeText,
  date: maybeText,
  description: maybeText,
  content: maybeText,
  body: maybeText,
  snippet: maybeText,
});
type AgentReachItem = z.output<typeof agentReachItemSchema>;

const agentReachResponseSchema = z.union([
  z.array(z.unknown()),
  z.object({
    data: z.array(z.unknown()).optional(),
    results: z.array(z.unknown()).optional(),
    jobs: z.array(z.unknown()).optional(),
    items: z.array(z.unknown()).optional(),
    next: maybeText,
    cursor: maybeText,
  }),
]);

function formatSalary(item: AgentReachItem): string {
  if (item.salary) return item.salary.trim();
  const min = item.salary_min;
  const max = item.salary_max;
  const cur = item.salary_currency ?? "";
  if (min != null && max != null) return `${cur} ${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")}`.trim();
  if (min != null) return `${cur} ${min.toLocaleString("en-US")}`.trim();
  if (max != null) return `${cur} ${max.toLocaleString("en-US")}`.trim();
  return "";
}

function parsePostedAt(item: AgentReachItem): string | null {
  const raw = item.posted_at ?? item.created_at ?? item.date;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function normalizePlatform(item: AgentReachItem): string {
  const candidate = (item.platform ?? item.via ?? item.source ?? "").trim();
  if (candidate) return candidate.slice(0, 100);
  const url = (item.url ?? item.link ?? "").toLowerCase();
  if (url.includes("linkedin.com")) return "LinkedIn";
  if (url.includes("reddit.com")) return "Reddit";
  return "AgentReach";
}

export function postingFromAgentReach(item: AgentReachItem, index: number): FoundPosting {
  const url = safeLink(item.url ?? item.link ?? "");
  const externalId = (item.id ?? item.externalId ?? (url ? url : `agentreach-${index}`)).slice(0, 500);
  const title = (item.title ?? "Untitled posting").trim().slice(0, 500);
  const company = (item.company ?? "Unknown").trim().slice(0, 300);
  const place = (item.place ?? item.location ?? "").trim().slice(0, 300);
  const description = (item.description ?? item.content ?? item.body ?? item.snippet ?? "").trim().slice(0, 100_000);
  const via = normalizePlatform(item);

  return {
    source: "AGENTREACH",
    externalId,
    title,
    company,
    place,
    remote: item.remote ?? null,
    salary: formatSalary(item).slice(0, 200),
    postedAt: parsePostedAt(item),
    url: url.slice(0, 2000),
    via,
    description,
    complete: true,
  };
}

function buildSearchUrl(baseUrl: string, query: SearchQuery, next: string | null): URL {
  const base = baseUrl.replace(/\/+$/, "") || AGENTREACH_DEFAULT_URL;
  // If the base URL includes a specific path (e.g. http://host:8080/api/jobs), keep it;
  // otherwise default to /api/search or /search
  const parsed = new URL(base);
  const path = parsed.pathname === "/" || parsed.pathname === "" ? "/api/search" : parsed.pathname;
  const url = new URL(path, parsed.origin);

  const q = [query.keywords, query.place].filter(Boolean).join(" ");
  url.searchParams.set("q", q || "software developer");
  if (query.country) url.searchParams.set("country", query.country);
  if (query.place) url.searchParams.set("location", query.place);
  if (query.remoteOnly) url.searchParams.set("remote", "true");
  if (query.postedWithin && query.postedWithin !== "any") url.searchParams.set("posted", query.postedWithin);
  if (query.experience && query.experience !== "any") url.searchParams.set("experience", query.experience);
  url.searchParams.set("platforms", "linkedin,reddit,web");

  if (next) url.searchParams.set("cursor", next);
  return url;
}

export const agentreach: JobSourceAdapter<"AGENTREACH"> = {
  source: "AGENTREACH",
  search: async (query, credentials, next, context = {}): Promise<SearchPage> => {
    const baseUrl = context.baseUrl ?? credentials.url ?? AGENTREACH_DEFAULT_URL;
    const url = buildSearchUrl(baseUrl, query, next);
    const headers: Record<string, string> = {};
    if (credentials.key) {
      headers["authorization"] = `Bearer ${credentials.key}`;
      headers["x-api-key"] = credentials.key;
    }

    const raw = await requestJson("AGENTREACH", url, { headers, signal: context.signal, timeoutMs: 15_000 });
    const parsed = agentReachResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw jobSearchError("changed", "AGENTREACH", { detail: `${url.pathname}: unexpected answer shape` });
    }

    const rawItems = Array.isArray(parsed.data)
      ? parsed.data
      : (parsed.data.jobs ?? parsed.data.results ?? parsed.data.data ?? parsed.data.items ?? []);

    const postings: FoundPosting[] = [];
    let idx = 0;
    for (const rawItem of rawItems) {
      const itemParsed = agentReachItemSchema.safeParse(rawItem);
      if (itemParsed.success) {
        postings.push(postingFromAgentReach(itemParsed.data, idx++));
      }
    }

    const nextCursor = !Array.isArray(parsed.data) ? (parsed.data.next ?? parsed.data.cursor ?? null) : null;
    return { postings, next: nextCursor };
  },
  details: async (posting) => (posting.description ? posting.description : null),
  test: async (credentials, context = {}): Promise<void> => {
    const baseUrl = (context.baseUrl ?? credentials.url ?? AGENTREACH_DEFAULT_URL).replace(/\/+$/, "");
    const headers: Record<string, string> = {};
    if (credentials.key) {
      headers["authorization"] = `Bearer ${credentials.key}`;
      headers["x-api-key"] = credentials.key;
    }

    // Try a health check endpoint first, or fall back to a minimal test query
    try {
      const healthUrl = new URL("/health", baseUrl);
      await requestJson("AGENTREACH", healthUrl, { headers, signal: context.signal, timeoutMs: 5_000 });
      return;
    } catch {
      // If /health isn't specifically answered, perform a small 1-result test query
      const testQuery: SearchQuery = {
        keywords: "engineer",
        place: "",
        country: "us",
        radiusKm: 25,
        remoteOnly: false,
        postedWithin: "any",
      };
      await agentreach.search(testQuery, credentials, null, context);
    }
  },
};
