import { z } from "zod";

/** Regions a watched company is interesting for. */
export const COMPANY_REGIONS = ["me", "eu", "remote", "global"] as const;
export type CompanyRegion = (typeof COMPANY_REGIONS)[number];

export const COMPANY_REGION_LABELS: Record<CompanyRegion, string> = {
  me: "Middle East",
  eu: "Europe",
  remote: "Remote",
  global: "Global",
};

/** Hard cap on the watched list (1000+ with room to grow). */
export const WATCHED_COMPANIES_MAX = 1500;

/**
 * Companies scanned in one agent run. Default 50 × 3 runs/day ≈ 1050 / week
 * so a 1000-company list finishes in about 7 days.
 */
export const COMPANY_BATCH_SIZES = [25, 40, 50, 75, 100] as const;
export type CompanyBatchSize = (typeof COMPANY_BATCH_SIZES)[number];
export const DEFAULT_COMPANY_BATCH_SIZE: CompanyBatchSize = 50;

/** Target days to walk the full enabled list once (for Settings copy). */
export const COMPANY_CYCLE_DAYS = 7;

/** Extra result pages per company search (1 = first page only). */
export const COMPANY_RESULT_PAGES = [1, 2, 3] as const;
export type CompanyResultPages = (typeof COMPANY_RESULT_PAGES)[number];
export const DEFAULT_COMPANY_RESULT_PAGES: CompanyResultPages = 1;

export const watchedCompanySchema = z.object({
  name: z.string().trim().min(1).max(120),
  regions: z.array(z.enum(COMPANY_REGIONS)).min(1).max(COMPANY_REGIONS.length),
  notes: z.string().trim().max(200).optional().default(""),
  enabled: z.boolean().default(true),
});
export type WatchedCompany = z.output<typeof watchedCompanySchema>;

export const watchedCompaniesSchema = z.array(watchedCompanySchema).max(WATCHED_COMPANIES_MAX);

/** Case-insensitive name key for merge / dedupe. */
export const companyNameKey = (name: string) => name.trim().toLowerCase();

/**
 * Merge a seed (or pasted) list into the current one: existing names win
 * (keep enabled/notes/regions); new names are appended up to the max.
 */
export function mergeWatchedCompanies(current: readonly WatchedCompany[], incoming: readonly WatchedCompany[]): WatchedCompany[] {
  const byName = new Map(current.map((company) => [companyNameKey(company.name), company]));
  for (const company of incoming) {
    if (byName.size >= WATCHED_COMPANIES_MAX) break;
    const key = companyNameKey(company.name);
    if (!key || byName.has(key)) continue;
    byName.set(key, watchedCompanySchema.parse(company));
  }
  return [...byName.values()];
}

/** Parse a paste of company names (one per line, or comma-separated). */
export function parseCompanyNames(text: string, regions: readonly CompanyRegion[] = ["global"]): WatchedCompany[] {
  const names = text
    .split(/[\n,;]+/)
    .map((name) => name.trim())
    .filter(Boolean);
  const regionList = regions.length > 0 ? [...regions] : (["global"] as CompanyRegion[]);
  const seen = new Set<string>();
  const companies: WatchedCompany[] = [];
  for (const name of names) {
    const key = companyNameKey(name);
    if (seen.has(key) || name.length > 120) continue;
    seen.add(key);
    companies.push(watchedCompanySchema.parse({ name, regions: regionList, notes: "", enabled: true }));
    if (companies.length >= WATCHED_COMPANIES_MAX) break;
  }
  return companies;
}

/** All enabled companies, in list order. */
export function enabledCompanies(companies: readonly WatchedCompany[]): WatchedCompany[] {
  return companies.filter((company) => company.enabled);
}

/**
 * Next slice of the enabled list for one run, wrapping when the cursor
 * passes the end so a 500+ list is covered across successive runs.
 */
export function nextCompanyBatch(
  companies: readonly WatchedCompany[],
  cursor: number,
  batchSize: number,
): { batch: WatchedCompany[]; nextCursor: number; totalEnabled: number; from: number; to: number } {
  const enabled = enabledCompanies(companies);
  const totalEnabled = enabled.length;
  if (totalEnabled === 0 || batchSize <= 0) {
    return { batch: [], nextCursor: 0, totalEnabled: 0, from: 0, to: 0 };
  }
  const size = Math.min(Math.max(1, batchSize), totalEnabled);
  const start = ((cursor % totalEnabled) + totalEnabled) % totalEnabled;
  const batch: WatchedCompany[] = [];
  for (let i = 0; i < size; i += 1) batch.push(enabled[(start + i) % totalEnabled]);
  const nextCursor = (start + size) % totalEnabled;
  return {
    batch,
    nextCursor,
    totalEnabled,
    from: start + 1,
    to: start + size > totalEnabled ? totalEnabled : start + size,
  };
}

/** @deprecated Prefer nextCompanyBatch — kept for older call sites/tests. */
export function companiesForScan(companies: readonly WatchedCompany[], cap: number = DEFAULT_COMPANY_BATCH_SIZE): WatchedCompany[] {
  return nextCompanyBatch(companies, 0, cap).batch;
}

/** Rough runs needed to visit every enabled company once. */
export function runsToCoverAll(totalEnabled: number, batchSize: number): number {
  if (totalEnabled <= 0 || batchSize <= 0) return 0;
  return Math.ceil(totalEnabled / batchSize);
}

/** Days to cover the list at `runsPerDay` (default agent daily cap). */
export function daysToCoverAll(totalEnabled: number, batchSize: number, runsPerDay = 3): number {
  if (totalEnabled <= 0 || batchSize <= 0 || runsPerDay <= 0) return 0;
  return Math.ceil(totalEnabled / (batchSize * runsPerDay));
}

/** Suggested batch size to finish `totalEnabled` within `days` at `runsPerDay`. */
export function batchSizeForCycle(totalEnabled: number, days = COMPANY_CYCLE_DAYS, runsPerDay = 3): CompanyBatchSize {
  if (totalEnabled <= 0) return DEFAULT_COMPANY_BATCH_SIZE;
  const needed = Math.ceil(totalEnabled / (days * runsPerDay));
  return COMPANY_BATCH_SIZES.find((size) => size >= needed) ?? COMPANY_BATCH_SIZES[COMPANY_BATCH_SIZES.length - 1];
}
