import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { countryName } from "@/lib/job-search/countries";
import { describeSearch, EMPTY_QUERY, isJobSource, JOB_SOURCES, searchQuerySchema, type JobSource, type SearchQuery } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";

// The job agent's saved searches (E16, #11): each a query, on the sources
// it names, or on every source the agent searches when it names none.

export type AgentSearch = {
  id: string;
  name: string;
  query: SearchQuery;
  /** Empty: every source the agent searches. */
  sources: JobSource[];
  enabled: boolean;
};

/** A saved search as Settings → Job agent sends it. */
export const agentSearchInputSchema = z.object({
  name: z.string().trim().max(80),
  query: searchQuerySchema,
  sources: z.array(z.enum(JOB_SOURCES)).max(JOB_SOURCES.length),
  enabled: z.boolean(),
});
export type AgentSearchInput = z.infer<typeof agentSearchInputSchema>;

const queryOf = (value: Prisma.JsonValue): SearchQuery => searchQuerySchema.catch(EMPTY_QUERY).parse(value);

/** Whether a search is complete enough to run: keywords and a country. */
export const agentQueryReady = (query: SearchQuery) => Boolean(query.keywords.trim() && query.country);

/** Its name, or the search in a line. */
export const agentSearchLabel = (search: Pick<AgentSearch, "name" | "query" | "sources">) =>
  search.name.trim() || describeSearch(search.query, countryName(search.query.country) || search.query.country.toUpperCase(), search.sources);

/** The saved searches, in their order. */
export async function loadAgentSearches(db: Prisma.TransactionClient = prisma): Promise<AgentSearch[]> {
  const rows = await db.agentSearch.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
  return rows.map((row) => ({ id: row.id, name: row.name, query: queryOf(row.query), sources: row.sources.filter(isJobSource), enabled: row.enabled }));
}

/** The sources a search asks: its own, of the ones the agent searches, or all of those. */
export const searchSources = (search: Pick<AgentSearch, "sources">, agentSources: readonly JobSource[]): JobSource[] =>
  search.sources.length === 0 ? [...agentSources] : agentSources.filter((source) => search.sources.includes(source));
