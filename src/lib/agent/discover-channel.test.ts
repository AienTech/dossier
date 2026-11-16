import { describe, expect, it } from "vitest";

import type { FoundPosting } from "@/lib/job-search/search";

import {
  channelForSource,
  discoverChannelOf,
  displayVia,
  tagDiscoverChannel,
  watchedCompanyOf,
} from "./discover-channel";

const base: FoundPosting = {
  source: "JSEARCH",
  externalId: "1",
  title: "Engineer",
  company: "Acme",
  place: "Remote",
  remote: true,
  url: "https://example.com/job",
  salary: "",
  via: "LinkedIn",
  description: "",
  postedAt: "2026-10-01T00:00:00Z",
  complete: true,
};

describe("discover channel", () => {
  it("maps FreeHire to careers and aggregators to job boards", () => {
    expect(channelForSource("FREEHIRE")).toBe("careers");
    expect(channelForSource("JSEARCH")).toBe("job_boards");
    expect(channelForSource("ADZUNA")).toBe("job_boards");
  });

  it("tags via so Agent can filter careers vs boards", () => {
    const careers = tagDiscoverChannel({ ...base, source: "FREEHIRE", via: "Greenhouse" }, "careers", "Revolut");
    expect(careers.via).toContain("Watched:Revolut");
    expect(careers.via).toContain("HireMe:careers");
    expect(discoverChannelOf(careers.via, "FREEHIRE")).toBe("careers");
    expect(watchedCompanyOf(careers.via)).toBe("Revolut");
    expect(displayVia(careers.via)).toBe("Greenhouse · Watched:Revolut");

    const boards = tagDiscoverChannel(base, "job_boards");
    expect(boards.via).toContain("HireMe:boards");
    expect(discoverChannelOf(boards.via, "JSEARCH")).toBe("job_boards");
    expect(displayVia(boards.via)).toBe("LinkedIn");
  });
});
