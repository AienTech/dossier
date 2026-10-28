import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, refused, stubFetch } from "@/lib/ai/test-http";

const fetchPosting = vi.hoisted(() => vi.fn());
vi.mock("@/lib/posting-fetch", () => ({ fetchPosting }));

import { JobSearchError } from "./errors";
import { companyFromAtsUrl, firecrawl, parseResultTitle, postingFromResult } from "./firecrawl";
import { EMPTY_QUERY, type SearchQuery } from "./search";

const query: SearchQuery = { ...EMPTY_QUERY, keywords: "data engineer", place: "Bengaluru", country: "in", postedWithin: "week" };
const creds = { key: "fc_test" };

beforeEach(() => {
  vi.unstubAllGlobals();
  fetchPosting.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const answer = (web: unknown[]) => json({ success: true, data: { web } });

describe("Firecrawl search", () => {
  it("POSTs /v2/search with the key, a job-board-biased query, country and location", async () => {
    const requests = stubFetch(() => answer([]));
    await firecrawl.search(query, creds, null);
    const [{ url, method, headers, body }] = requests;
    const parsed = body as { query: string; country?: string; location?: string; tbs?: string };
    expect(method).toBe("POST");
    expect(`${url.origin}${url.pathname}`).toBe("https://api.firecrawl.dev/v2/search");
    expect(headers.get("authorization")).toBe("Bearer fc_test");
    expect(parsed).toMatchObject({ country: "IN", location: "Bengaluru", tbs: "qdr:w" });
    expect(parsed.query).toContain("data engineer jobs in Bengaluru");
    expect(parsed.query).toContain("site:linkedin.com");
    expect(parsed.query).toContain("site:naukri.com");
  });

  it("widens a 3-day search to a week, since Google has no 3-day unit", async () => {
    const requests = stubFetch(() => answer([]));
    await firecrawl.search({ ...query, postedWithin: "3days" }, creds, null);
    expect(requests[0].body).toMatchObject({ tbs: "qdr:w" });
  });

  it("asks for no date range at all, and defaults the location to the whole country", async () => {
    const requests = stubFetch(() => answer([]));
    await firecrawl.search({ ...query, place: "", postedWithin: "any" }, creds, null);
    expect(requests[0].body).not.toHaveProperty("tbs");
    expect(requests[0].body).toMatchObject({ location: "India" });
  });

  it("never offers a next page: Firecrawl's search has no cursor", async () => {
    stubFetch(() => answer([{ url: "https://example.com/1", title: "Data Engineer" }]));
    const page = await firecrawl.search(query, creds, null);
    expect(page.next).toBeNull();
  });

  it("drops results with no usable link or title, and de-duplicates by link", async () => {
    stubFetch(() =>
      answer([
        { url: "https://example.com/a", title: "Data Engineer" },
        { url: "javascript:alert(1)", title: "Data Engineer" },
        { url: "https://example.com/a", title: "Data Engineer (duplicate)" },
        { url: "https://example.com/b", title: "" },
      ]),
    );
    const page = await firecrawl.search(query, creds, null);
    expect(page.postings).toHaveLength(1);
    expect(page.postings[0].url).toBe("https://example.com/a");
  });

  it("says the source isn't answering when it can't be reached", async () => {
    stubFetch(refused);
    await expect(firecrawl.search(query, creds, null)).rejects.toMatchObject({ problem: "unavailable" });
  });

  it("says the key was refused on 401", async () => {
    stubFetch(() => json({ success: false }, { status: 401 }));
    await expect(firecrawl.search(query, creds, null)).rejects.toMatchObject({ problem: "key" });
  });

  it("says the source changed when success is false with a 200", async () => {
    stubFetch(() => json({ success: false, data: { web: [] } }));
    const error = await firecrawl.search(query, creds, null).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JobSearchError);
    expect(error).toMatchObject({ problem: "changed" });
  });
});

describe("companyFromAtsUrl", () => {
  it("reads the company from the path on each applicant-tracking system", () => {
    expect(companyFromAtsUrl("https://job-boards.greenhouse.io/acmecorp/jobs/1234")).toBe("Acmecorp");
    expect(companyFromAtsUrl("https://jobs.lever.co/acme-corp/abc-123")).toBe("Acme Corp");
    expect(companyFromAtsUrl("https://jobs.ashbyhq.com/acmecorp/posting")).toBe("Acmecorp");
    expect(companyFromAtsUrl("https://jobs.smartrecruiters.com/Acmecorp/job")).toBe("Acmecorp");
    expect(companyFromAtsUrl("https://acmecorp.wd1.myworkdayjobs.com/en-US/careers/job/123")).toBe("Acmecorp");
  });

  it("gives up on a link that isn't a known applicant-tracking system, or isn't a link at all", () => {
    expect(companyFromAtsUrl("https://www.linkedin.com/jobs/view/123")).toBe("");
    expect(companyFromAtsUrl("not a url")).toBe("");
  });
});

describe("parseResultTitle", () => {
  it("splits 'Company hiring Role in Place' from LinkedIn-style titles", () => {
    expect(parseResultTitle("Acme Corp hiring Senior Data Engineer in Bengaluru | LinkedIn")).toEqual({
      title: "Senior Data Engineer",
      company: "Acme Corp",
    });
  });

  it("splits 'Role - Company - Place' from Indeed/Naukri-style titles", () => {
    expect(parseResultTitle("Senior Data Engineer - Acme Corp - Bengaluru")).toEqual({ title: "Senior Data Engineer", company: "Bengaluru" });
  });

  it("falls back to the whole title with no company when nothing matches", () => {
    expect(parseResultTitle("Senior Data Engineer")).toEqual({ title: "Senior Data Engineer", company: "" });
  });
});

describe("postingFromResult", () => {
  it("prefers the ATS URL's company over a guess from the title", () => {
    const posting = postingFromResult({
      url: "https://job-boards.greenhouse.io/acmecorp/jobs/1234",
      title: "Senior Data Engineer",
      description: "Build our data platform.",
      markdown: null,
    });
    expect(posting).toMatchObject({ source: "FIRECRAWL", title: "Senior Data Engineer", company: "Acmecorp", complete: false });
    expect(posting.externalId).toBe(posting.url);
  });

  it("uses the title guess when the link isn't a known ATS", () => {
    const posting = postingFromResult({
      url: "https://www.linkedin.com/jobs/view/123",
      title: "Acme Corp hiring Senior Data Engineer in Bengaluru | LinkedIn",
      description: null,
      markdown: "**Build** our data platform.",
    });
    expect(posting).toMatchObject({ title: "Senior Data Engineer", company: "Acme Corp", description: "Build our data platform." });
  });
});

describe("Firecrawl details and test", () => {
  it("fetches the posting's own page for the rest of it, like Adzuna does", async () => {
    fetchPosting.mockResolvedValueOnce({ ok: true, text: "The whole posting.", source: "page", url: "https://example.com/job" });
    const posting = postingFromResult({ url: "https://example.com/job", title: "Data Engineer", description: "snippet", markdown: null });
    expect(await firecrawl.details(posting, creds)).toBe("The whole posting.");
    expect(fetchPosting).toHaveBeenCalledWith(posting.url);

    fetchPosting.mockResolvedValueOnce({ ok: false, error: "unreadable" });
    expect(await firecrawl.details(posting, creds)).toBeNull();
    expect(await firecrawl.details({ ...posting, url: "" }, creds)).toBeNull();
  });

  it("tests the key with one small search", async () => {
    const requests = stubFetch(() => answer([]));
    await firecrawl.test(creds);
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({ query: expect.stringContaining("developer jobs") });
  });
});
