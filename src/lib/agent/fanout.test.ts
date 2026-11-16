import { describe, expect, it } from "vitest";

import type { FoundPosting } from "@/lib/job-search/search";

import { buildAgentSearchPlans, mergeAgentPostings } from "./fanout";
import { EMPTY_AGENT_QUERY } from "./query";

const posting = (id: string, source: FoundPosting["source"], url: string, company = "Acme"): FoundPosting => ({
  source,
  externalId: id,
  title: "Engineer",
  company,
  place: "Remote",
  remote: true,
  salary: "",
  postedAt: "2026-10-01T00:00:00Z",
  url,
  via: "",
  description: "Build things.",
  complete: true,
});

describe("buildAgentSearchPlans", () => {
  it("makes one base plan per source and company plans on FreeHire when available", () => {
    const query = { ...EMPTY_AGENT_QUERY, keywords: "frontend", country: "de", sponsorship: "prefer" as const };
    const companies = [{ name: "Spotify", regions: ["eu" as const], notes: "", enabled: true }];
    const plans = buildAgentSearchPlans(query, ["JSEARCH", "FREEHIRE"], companies);
    expect(plans.filter((plan) => plan.reason === "base").map((plan) => plan.source)).toEqual(["JSEARCH", "FREEHIRE"]);
    expect(plans.filter((plan) => plan.reason === "company")).toEqual([
      expect.objectContaining({ source: "FREEHIRE", company: "Spotify", query: expect.objectContaining({ keywords: expect.stringContaining("Spotify") }) }),
    ]);
    expect(plans[0].query.keywords).toContain("Blue Card");
  });

  it("builds one company plan per company in the batch", () => {
    const companies = Array.from({ length: 5 }, (_, index) => ({
      name: `Co ${index}`,
      regions: ["global" as const],
      notes: "",
      enabled: true,
    }));
    const plans = buildAgentSearchPlans({ ...EMPTY_AGENT_QUERY, keywords: "x", country: "us" }, ["JSEARCH"], companies);
    expect(plans.filter((plan) => plan.reason === "company")).toHaveLength(5);
    expect(plans.every((plan) => plan.source === "JSEARCH")).toBe(true);
  });

  it("fans out empty country across worldwide codes for JSearch, keeps FreeHire global", () => {
    const plans = buildAgentSearchPlans({ ...EMPTY_AGENT_QUERY, keywords: "engineer", country: "" }, ["JSEARCH", "FREEHIRE"], []);
    const jsearch = plans.filter((plan) => plan.source === "JSEARCH");
    const freehire = plans.filter((plan) => plan.source === "FREEHIRE");
    expect(jsearch.length).toBeGreaterThan(1);
    expect(jsearch.every((plan) => plan.query.country.length === 2)).toBe(true);
    expect(freehire).toEqual([expect.objectContaining({ query: expect.objectContaining({ country: "" }) })]);
  });
});

describe("mergeAgentPostings", () => {
  it("dedupes by source id and by link across sources", () => {
    const a = posting("1", "JSEARCH", "https://jobs.example/a?utm_source=x");
    const sameLink = posting("az", "ADZUNA", "https://jobs.example/a?utm_medium=y");
    const other = posting("2", "FREEHIRE", "https://jobs.example/b");
    expect(mergeAgentPostings([[a, other], [sameLink]]).map((row) => row.externalId)).toEqual(["1", "2"]);
  });
});
