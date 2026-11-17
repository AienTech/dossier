import { afterEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";

const env = vi.hoisted(() => ({ HIREME_FREEHIRE_URL: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env }));

import {
  addDiscovererCompany,
  discovererBaseUrl,
  discovererScrapeStatus,
  listDiscovererCompanies,
  pauseDiscovererScrape,
  removeDiscovererCompany,
  startDiscovererScrape,
} from "./discoverer";

afterEach(() => {
  env.HIREME_FREEHIRE_URL = undefined;
  vi.unstubAllGlobals();
});

describe("discovererBaseUrl", () => {
  it("is unset without HIREME_FREEHIRE_URL, and ignores non-local hosts", () => {
    expect(discovererBaseUrl()).toBeNull();
    env.HIREME_FREEHIRE_URL = "https://freehire.me";
    expect(discovererBaseUrl()).toBeNull();
    env.HIREME_FREEHIRE_URL = "not a url";
    expect(discovererBaseUrl()).toBeNull();
  });

  it("returns a trimmed local sidecar base URL", () => {
    env.HIREME_FREEHIRE_URL = "http://127.0.0.1:8787/";
    expect(discovererBaseUrl()).toBe("http://127.0.0.1:8787");
    env.HIREME_FREEHIRE_URL = "http://localhost:8787";
    expect(discovererBaseUrl()).toBe("http://localhost:8787");
    env.HIREME_FREEHIRE_URL = "http://host.docker.internal:8787";
    expect(discovererBaseUrl()).toBe("http://host.docker.internal:8787");
  });
});

describe("discoverer API", () => {
  const company = { id: "c1", name: "Ledgerly", ats: "greenhouse", slug: "ledgerly", url: "https://boards.example/ledgerly" };
  const progress = {
    status: "idle",
    started_at: null,
    finished_at: null,
    current: null,
    message: "Ready",
    total: 0,
    done: 0,
    failed: 0,
    pending: 0,
    percent: 0,
    can_resume: false,
    companies: [],
  };

  it("lists, adds and removes companies on the local sidecar", async () => {
    env.HIREME_FREEHIRE_URL = "http://127.0.0.1:8787";
    const requests = stubFetch((request) => {
      if (request.url.pathname === "/api/v1/companies" && request.method === "GET") return json({ data: [company] });
      if (request.url.pathname === "/api/v1/companies" && request.method === "POST") return json({ data: company });
      if (request.url.pathname === "/api/v1/companies/c1" && request.method === "DELETE") return json({});
      return json({ error: "unexpected" }, { status: 500 });
    });

    expect(await listDiscovererCompanies()).toEqual([company]);
    expect(await addDiscovererCompany({ name: "Ledgerly", ats: "greenhouse", slug: "ledgerly" })).toEqual(company);
    await removeDiscovererCompany("c1");

    expect(requests.map(({ method, url }) => [method, url.pathname])).toEqual([
      ["GET", "/api/v1/companies"],
      ["POST", "/api/v1/companies"],
      ["DELETE", "/api/v1/companies/c1"],
    ]);
  });

  it("starts, pauses and reads scrape progress", async () => {
    env.HIREME_FREEHIRE_URL = "http://127.0.0.1:8787";
    stubFetch(() => json(progress));
    expect(await discovererScrapeStatus()).toEqual(progress);
    expect(await startDiscovererScrape({ resume: true })).toEqual(progress);
    expect(await pauseDiscovererScrape()).toEqual(progress);
  });

  it("surfaces sidecar errors", async () => {
    env.HIREME_FREEHIRE_URL = "http://127.0.0.1:8787";
    stubFetch(() => json({ error: "nope" }, { status: 503 }));
    await expect(listDiscovererCompanies()).rejects.toThrow(/company watchlist/i);
    await expect(addDiscovererCompany({ name: "X" })).rejects.toThrow(/nope|Couldn’t add/i);
    await expect(removeDiscovererCompany("missing")).rejects.toThrow(/nope|Couldn’t remove/i);
    await expect(discovererScrapeStatus()).rejects.toThrow(/scrape progress/i);
    await expect(startDiscovererScrape()).rejects.toThrow(/start the scrape/i);
    await expect(pauseDiscovererScrape()).rejects.toThrow(/pause the scrape/i);
  });

  it("refuses calls when the discoverer isn’t configured", async () => {
    await expect(listDiscovererCompanies()).rejects.toThrow(/isn’t configured/i);
  });
});
