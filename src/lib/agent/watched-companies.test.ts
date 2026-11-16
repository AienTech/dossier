import { describe, expect, it } from "vitest";

import { WATCHED_COMPANIES_SEED } from "./watched-companies-seed";
import {
  COMPANY_CYCLE_DAYS,
  DEFAULT_COMPANY_BATCH_SIZE,
  WATCHED_COMPANIES_MAX,
  batchSizeForCycle,
  companiesForScan,
  daysToCoverAll,
  mergeWatchedCompanies,
  nextCompanyBatch,
  parseCompanyNames,
  runsToCoverAll,
  watchedCompaniesSchema,
} from "./watched-companies";

describe("watched companies", () => {
  it("parses and merges the seed without duplicating names", () => {
    expect(watchedCompaniesSchema.parse(WATCHED_COMPANIES_SEED).length).toBe(WATCHED_COMPANIES_SEED.length);
    const keys = WATCHED_COMPANIES_SEED.map((company) => company.name.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(WATCHED_COMPANIES_SEED.some((company) => company.name === "Revolut")).toBe(true);
    expect(WATCHED_COMPANIES_SEED.some((company) => company.name === "Rakuten")).toBe(true);
    expect(WATCHED_COMPANIES_SEED.some((company) => company.name === "Deutsche Telekom")).toBe(true);
    expect(WATCHED_COMPANIES_SEED.some((company) => company.name === "Zapier")).toBe(true);

    const existing = [{ name: "Spotify", regions: ["eu" as const], notes: "mine", enabled: false }];
    const merged = mergeWatchedCompanies(existing, [...WATCHED_COMPANIES_SEED]);
    expect(merged.find((company) => company.name === "Spotify")).toEqual(existing[0]);
    expect(merged.length).toBeGreaterThan(existing.length);
    expect(merged.filter((company) => company.name.toLowerCase() === "spotify")).toHaveLength(1);
  });

  it("rotates batches so a large list is covered across runs", () => {
    const list = Array.from({ length: 50 }, (_, index) => ({
      name: `Co ${index}`,
      regions: ["remote" as const],
      notes: "",
      enabled: true,
    }));
    const first = nextCompanyBatch(list, 0, 20);
    expect(first.batch.map((company) => company.name)).toEqual(list.slice(0, 20).map((company) => company.name));
    expect(first.nextCursor).toBe(20);
    expect(first.from).toBe(1);
    expect(first.to).toBe(20);

    const second = nextCompanyBatch(list, first.nextCursor, 20);
    expect(second.batch[0].name).toBe("Co 20");
    expect(second.nextCursor).toBe(40);

    const wrap = nextCompanyBatch(list, 40, 20);
    expect(wrap.batch).toHaveLength(20);
    expect(wrap.batch[0].name).toBe("Co 40");
    expect(wrap.batch.at(-1)?.name).toBe("Co 9");
    expect(wrap.nextCursor).toBe(10);
    expect(runsToCoverAll(500, 25)).toBe(20);
    expect(companiesForScan(list, 5)).toHaveLength(5);
  });

  it("targets a ~7-day cycle at default batch size and three runs per day", () => {
    expect(DEFAULT_COMPANY_BATCH_SIZE).toBe(50);
    expect(daysToCoverAll(1050, 50)).toBe(COMPANY_CYCLE_DAYS);
    expect(daysToCoverAll(1500, 75)).toBe(COMPANY_CYCLE_DAYS);
    expect(batchSizeForCycle(1000)).toBe(50);
    expect(batchSizeForCycle(1500)).toBe(75);
    expect(batchSizeForCycle(0)).toBe(DEFAULT_COMPANY_BATCH_SIZE);
  });

  it("parses a pasted bulk list and respects the max", () => {
    const parsed = parseCompanyNames("Spotify\nGitLab, Careem\n\nSpotify", ["remote", "me"]);
    expect(parsed.map((company) => company.name)).toEqual(["Spotify", "GitLab", "Careem"]);
    expect(parsed[0].regions).toEqual(["remote", "me"]);

    const huge = Array.from({ length: WATCHED_COMPANIES_MAX + 50 }, (_, index) => `Firm ${index}`).join("\n");
    expect(parseCompanyNames(huge)).toHaveLength(WATCHED_COMPANIES_MAX);
    expect(mergeWatchedCompanies([], parseCompanyNames(huge))).toHaveLength(WATCHED_COMPANIES_MAX);
  });
});
