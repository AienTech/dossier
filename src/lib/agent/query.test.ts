import { describe, expect, it } from "vitest";

import {
  EMPTY_AGENT_QUERY,
  agentQuerySchema,
  asAgentQuery,
  asSearchQuery,
  filterBySponsorship,
  mentionsSponsorship,
  sponsorshipBiasTerms,
  withSponsorshipBias,
} from "./query";

describe("agentQuerySchema", () => {
  it("fills sponsorship and sources when an old Find-jobs query is saved", () => {
    expect(
      agentQuerySchema.parse({
        keywords: "engineer",
        place: "Dubai",
        country: "ae",
        radiusKm: 50,
        remoteOnly: true,
        postedWithin: "week",
      }),
    ).toEqual({
      keywords: "engineer",
      place: "Dubai",
      country: "ae",
      radiusKm: 50,
      remoteOnly: true,
      postedWithin: "week",
      sponsorship: "any",
      sources: [],
    });
  });

  it("lifts a SearchQuery and strips agent fields for adapters", () => {
    const query = asAgentQuery({
      keywords: "designer",
      place: "Berlin",
      country: "de",
      radiusKm: 25,
      remoteOnly: false,
      postedWithin: "any",
    });
    expect(query.sponsorship).toBe("any");
    expect(asSearchQuery({ ...query, sponsorship: "prefer", sources: ["JSEARCH"] })).toEqual({
      keywords: "designer",
      place: "Berlin",
      country: "de",
      radiusKm: 25,
      remoteOnly: false,
      postedWithin: "any",
    });
  });
});

describe("sponsorship bias and filter", () => {
  it("appends region-aware terms when prefer/require", () => {
    expect(sponsorshipBiasTerms("us")).toContain("H-1B");
    expect(sponsorshipBiasTerms("de")).toContain("Blue Card");
    expect(sponsorshipBiasTerms("ae")).toContain("visa sponsorship");
    expect(withSponsorshipBias({ ...EMPTY_AGENT_QUERY, keywords: "SWE", country: "us", sponsorship: "any" }).keywords).toBe("SWE");
    expect(withSponsorshipBias({ ...EMPTY_AGENT_QUERY, keywords: "SWE", country: "us", sponsorship: "prefer" }).keywords).toContain("H-1B");
  });

  it("require keeps only postings that mention sponsorship or relocation", () => {
    const yes = {
      title: "Engineer",
      description: "We offer visa sponsorship and relocation support.",
      place: "Berlin",
      salary: "",
    };
    const no = { title: "Engineer", description: "Must already have the right to work.", place: "Berlin", salary: "" };
    expect(mentionsSponsorship(yes)).toBe(true);
    expect(mentionsSponsorship(no)).toBe(false);
    expect(filterBySponsorship([yes, no], "require")).toEqual([yes]);
    expect(filterBySponsorship([yes, no], "prefer")).toHaveLength(2);
  });
});
