import { afterEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";

import { agentreach } from "./agentreach";
import { EMPTY_QUERY } from "./search";

const query = {
  ...EMPTY_QUERY,
  keywords: "frontend engineer",
  place: "San Francisco",
  country: "us",
  radiusKm: 25 as const,
  remoteOnly: true,
  postedWithin: "week" as const,
};

const agentReachMockResponse = {
  jobs: [
    {
      id: "li-12345",
      title: "Senior Frontend Engineer",
      company: "TechCorp",
      location: "San Francisco, CA",
      url: "https://www.linkedin.com/jobs/view/12345",
      platform: "LinkedIn",
      remote: true,
      salary: "$160,000 - $190,000 a year",
      posted_at: "2026-11-01T12:00:00Z",
      description: "We are looking for a Senior Frontend Engineer proficient in React and Next.js.",
    },
    {
      id: "reddit-67890",
      title: "Hiring React Developer (Remote)",
      company: "IndieDevs",
      location: "Remote",
      url: "https://www.reddit.com/r/forhire/comments/67890",
      platform: "Reddit",
      remote: true,
      posted_at: "2026-11-02T10:00:00Z",
      description: "Looking for a contract React developer to assist with our SaaS application.",
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AgentReach search adapter", () => {
  it("translates search query to AgentReach endpoint and maps postings from LinkedIn and Reddit", async () => {
    const requests = stubFetch(() => json(agentReachMockResponse));
    const page = await agentreach.search(query, { url: "http://localhost:8080", key: "test-token" }, null);

    expect(requests.length).toBe(1);
    const { url, headers } = requests[0];
    expect(url.origin).toBe("http://localhost:8080");
    expect(url.pathname).toBe("/api/search");
    expect(url.searchParams.get("q")).toBe("frontend engineer San Francisco");
    expect(url.searchParams.get("country")).toBe("us");
    expect(url.searchParams.get("remote")).toBe("true");
    expect(url.searchParams.get("platforms")).toBe("linkedin,reddit,web");
    expect(headers.get("authorization")).toBe("Bearer test-token");

    expect(page.postings).toHaveLength(2);
    expect(page.postings[0]).toEqual({
      source: "AGENTREACH",
      externalId: "li-12345",
      title: "Senior Frontend Engineer",
      company: "TechCorp",
      place: "San Francisco, CA",
      remote: true,
      salary: "$160,000 - $190,000 a year",
      postedAt: "2026-11-01T12:00:00.000Z",
      url: "https://www.linkedin.com/jobs/view/12345",
      via: "LinkedIn",
      description: "We are looking for a Senior Frontend Engineer proficient in React and Next.js.",
      complete: true,
    });

    expect(page.postings[1]).toEqual({
      source: "AGENTREACH",
      externalId: "reddit-67890",
      title: "Hiring React Developer (Remote)",
      company: "IndieDevs",
      place: "Remote",
      remote: true,
      salary: "",
      postedAt: "2026-11-02T10:00:00.000Z",
      url: "https://www.reddit.com/r/forhire/comments/67890",
      via: "Reddit",
      description: "Looking for a contract React developer to assist with our SaaS application.",
      complete: true,
    });
  });

  it("test verifies connectivity", async () => {
    stubFetch(() => json({ status: "ok" }));
    await expect(agentreach.test({ url: "http://localhost:8080", key: null })).resolves.toBeUndefined();
  });
});
