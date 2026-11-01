import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { demoProfile } from "@/lib/demo-profile";
import type { FoundPosting, SearchQuery } from "@/lib/job-search/search";
import type { JobContext } from "@/lib/jobs/runner";
import { sweepFinishedJobs } from "@/lib/jobs/retention";
import { encryptSecret, TYPESAFE_KEY } from "@/lib/secrets";
import { saveSettings, loadSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { MockProvider } from "../ai/providers/mock";

import { agentDedupeKey } from "./candidates";
import { runAgentScan } from "./run";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
// Settings → Scoring reads DOSSIER_SCORER (#274).
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
// Drafts are their own jobs; here it's enough to see them queued.
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "draft-job"),
}));
// The sweep also removes old PDF zips, which isn't what's tested here.
vi.mock("@/lib/jobs/zip-pdfs", () => ({ removeOldZips: async () => {} }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});

// A fake source that counts its requests, and a fake AI that scores by title.
const fake = vi.hoisted(() => ({
  postings: [] as FoundPosting[],
  /** Pages by cursor, when a test needs more than one; `postings` otherwise. */
  pages: null as Record<string, FoundPosting[]> | null,
  searches: 0,
  asked: [] as { source: string; keywords: string; next: string | null }[],
  sources: ["JSEARCH"] as ("JSEARCH" | "ADZUNA" | "FREEHIRE" | "ARBEITSAGENTUR")[],
  ai: true,
  failOn: null as string | null,
  onScore: (() => {}) as (title: string) => void,
}));
vi.mock("@/lib/job-search", () => ({
  searchPostings: vi.fn(async (source: string, _credentials: unknown, query: { keywords: string }, next: string | null) => {
    fake.searches += 1;
    fake.asked.push({ source, keywords: query.keywords, next });
    if (fake.pages) {
      const at = next ?? "1";
      return { postings: fake.pages[at] ?? [], next: fake.pages[String(Number(at) + 1)] ? String(Number(at) + 1) : null };
    }
    return { postings: fake.postings.map((posting) => ({ ...posting, source })), next: "2" };
  }),
}));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({
    sources: fake.sources,
    saved: true,
    jsearch: { key: "jsearch-key", host: "openwebninja", keyState: "set" },
    adzuna: { appId: "app", key: "adzuna-key", keyState: "set" },
  }),
  agentSources: (config: { sources: string[] }) => config.sources.filter((source) => source !== "ARBEITSAGENTUR"),
  credentialsFor: () => ({ key: "jsearch-key", host: "openwebninja" }),
  requestContext: () => ({}),
}));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => fake.ai }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () =>
    new MockProvider({
      reply: (call) => {
        const { title } = JSON.parse(call.messages[0].content.split("The posting's facts:\n")[1].split("\n\nThe posting:")[0]) as { title: string };
        fake.onScore(title);
        if (title === fake.failOn) return "not json at all";
        return { score: /senior/i.test(title) ? 90 : /designer/i.test(title) ? 75 : 40, reasons: [`Fits ${title}.`], redFlags: [] };
      },
    }),
}));

const prisma = () => db.client!;
const query: SearchQuery = { keywords: "Product designer", place: "Rotterdam", country: "nl", radiusKm: 25, remoteOnly: false, postedWithin: "any" };
const now = new Date("2026-10-20T08:00:00Z");
const hour = 60 * 60 * 1000;

const posting = (id: string, title: string, posted: string, extra: Partial<FoundPosting> = {}): FoundPosting => ({
  source: "JSEARCH",
  externalId: id,
  title,
  company: `Company ${id}`,
  place: "Rotterdam",
  remote: false,
  salary: "",
  postedAt: posted,
  url: `https://jobs.example/${id}?utm_source=x`,
  via: "LinkedIn",
  description: `${title} at Company ${id}.`,
  complete: false,
  ...extra,
});
const page = [
  posting("a", "Senior Product Designer", "2026-10-19T00:00:00Z"),
  posting("b", "Product Designer", "2026-10-18T00:00:00Z"),
  // No link: its dedupe key is company, title and place.
  posting("c", "Office Manager", "2026-10-17T00:00:00Z", { url: "" }),
];

const context = (abort?: AbortController): JobContext & { steps: string[] } => {
  const steps: string[] = [];
  return { id: "agent-job", steps, step: async (name) => void steps.push(name), signal: (abort ?? new AbortController()).signal };
};

const addSearch = (name: string, extra: { keywords?: string; country?: string; sources?: ("JSEARCH" | "ADZUNA" | "FREEHIRE")[]; enabled?: boolean } = {}) =>
  prisma().agentSearch.create({
    data: {
      name,
      query: { ...query, keywords: extra.keywords ?? query.keywords, country: extra.country ?? query.country },
      sources: extra.sources ?? [],
      enabled: extra.enabled ?? true,
      sort: Date.now() % 100000,
    },
  });

beforeEach(async () => {
  await resetDatabase(prisma());
  Object.assign(fake, { postings: page, pages: null, searches: 0, asked: [], sources: ["JSEARCH"], ai: true, failOn: null, onScore: () => {} });
  await saveSettings({ agentEnabled: true });
  await addSearch("Designers");
});
afterAll(() => prisma().$disconnect());

describe("runAgentScan (E16-3)", () => {
  it("searches once, scores the new postings and keeps them, below the minimum too", async () => {
    const run = context();
    const result = await runAgentScan({ manual: false }, run, now);
    expect(fake.searches).toBe(1);
    expect(run.steps).toEqual(["Searching for new postings", "Scoring 3 postings"]);
    expect(result).toEqual({ found: 3, fresh: 3, scored: 3, drafted: 0, skipped: 0, message: "2 new postings are waiting for a look." });
    const candidates = await prisma().agentCandidate.findMany({ orderBy: { score: "desc" } });
    expect(candidates.map((candidate) => [candidate.externalId, candidate.score, candidate.status])).toEqual([
      ["a", 90, "SCORED"],
      ["b", 75, "SCORED"],
      ["c", 40, "SCORED"],
    ]);
    expect(candidates[0]).toMatchObject({ title: "Senior Product Designer", reasons: ["Fits Senior Product Designer."], dedupeKey: agentDedupeKey(page[0]) });
    // Find jobs shows the scores too (#208).
    expect((await prisma().postingScore.findMany({ orderBy: { score: "desc" } })).map((row) => [row.externalId, row.score])).toEqual([["a", 90], ["b", 75], ["c", 40]]);
    // The run is on record, with how it ended and how its search did; so is its request.
    const settings = await loadSettings();
    expect(settings.agentRuns).toEqual([
      {
        at: now.toISOString(),
        manual: false,
        message: "2 new postings are waiting for a look.",
        searches: [{ searchId: expect.any(String), searchName: "Designers", source: "JSEARCH", found: 3, fresh: 3, error: null }],
      },
    ]);
    expect(settings.agentRequests).toHaveLength(1);
    // Each candidate names the search that found it.
    expect(await prisma().agentCandidateSearch.count({ where: { searchName: "Designers" } })).toBe(3);
  });

  it("scores with Jev when Settings → Scoring chose it, without an AI provider (#274)", async () => {
    fake.ai = false;
    await saveSettings({ scorer: "JEV" });
    expect(await runAgentScan({ manual: false }, context(), now)).toMatchObject({ found: 0, message: "Enter your TypeSafe key in Settings → Scoring first." });
    expect(fake.searches).toBe(0);

    await saveSettings({ typesafeKeyEnc: encryptSecret(TYPESAFE_KEY, "ts_secret") });
    // Jev at its most sure: every Score at the top for a designer's posting and at the bottom otherwise.
    const requests = stubFetch(({ body }) => {
      const { questions, state } = body as { questions: Record<string, { type: string; criteria?: unknown[] }>; state: { posting: { title: string } } };
      const fits = /designer/i.test(state.posting.title);
      const answer = (id: string, question: { type: string; criteria?: unknown[] }) =>
        question.type === "score"
          ? { type: "score", score: fits ? question.criteria!.length - 1 : 0, confidence: 0.9, probabilities: {} }
          : question.type === "choice"
            ? { type: "choice", choice: "required", confidence: 0.9, probabilities: {} }
            : { type: "noul", noul: id.endsWith("Shown") && fits ? 0.9 : 0.05 };
      return json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, answer(id, question)])) });
    });
    const result = await runAgentScan({ manual: false }, context(), now);
    vi.unstubAllGlobals();

    expect(result).toMatchObject({ found: 3, scored: 3, message: "2 new postings are waiting for a look." });
    expect(requests.map((request) => request.headers.get("authorization"))).toEqual(["Bearer ts_secret", "Bearer ts_secret", "Bearer ts_secret"]);
    const candidates = await prisma().agentCandidate.findMany({ orderBy: { externalId: "asc" } });
    expect(candidates.map((candidate) => [candidate.externalId, candidate.score])).toEqual([["a", 100], ["b", 100], ["c", 0]]);
    expect(candidates[0].reasons).toContain("Covers: Senior Product Designer at Company a.");
    expect(candidates[2].redFlags).toEqual(["The role's level is far from your experience.", "Missing: Office Manager at Company c."]);
    expect((await prisma().postingScore.findFirstOrThrow({ where: { externalId: "a" } })).scoredWith).toBe("score-posting-jev@1 (jev-1.14.0)");
  });

  it("scores the newest new postings first, up to the cap", async () => {
    await saveSettings({ agentMaxScores: 2 });
    const scoredTitles: string[] = [];
    fake.onScore = (title) => scoredTitles.push(title);
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(scoredTitles).toEqual(["Senior Product Designer", "Product Designer"]);
    expect(result).toMatchObject({ fresh: 3, scored: 2 });
  });

  it("never brings back what it has seen, from another run or another source", async () => {
    await runAgentScan({ manual: false }, context(), now);
    const again = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(again).toEqual({ found: 3, fresh: 0, scored: 0, drafted: 0, skipped: 3, message: "No new postings this time." });

    // The same jobs from Adzuna: one by its link, one by company, title and place.
    fake.postings = [
      posting("az-1", "Senior Product Designer", "2026-10-19T00:00:00Z", { source: "ADZUNA", url: "https://jobs.example/a?utm_medium=y" }),
      posting("az-2", "Office  Manager", "2026-10-18T00:00:00Z", { source: "ADZUNA", url: "", company: "COMPANY c" }),
      posting("az-3", "Brand Designer", "2026-10-20T00:00:00Z", { source: "ADZUNA" }),
    ];
    const third = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 4 * hour));
    expect(third).toMatchObject({ found: 3, fresh: 1, scored: 1, skipped: 2 });
  });

  it("leaves out postings saved, dismissed or applied for in Find jobs", async () => {
    const application = await prisma().application.create({ data: {} });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "a", savedAt: now } });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "b", dismissedAt: now } });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "c", applicationId: application.id } });
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ found: 3, fresh: 0, skipped: 3 });
    expect(await prisma().agentCandidate.count()).toBe(0);
  });

  it("stops without asking a source when it's off or not set up", async () => {
    const stop = async (manual = false) => (await runAgentScan({ manual }, context(), now)).message;
    await saveSettings({ agentEnabled: false });
    expect(await stop()).toBe("The job agent is off.");
    await saveSettings({ agentEnabled: true });
    await prisma().agentSearch.deleteMany();
    expect(await stop()).toBe("Add a search in Settings → Job agent first.");
    const search = await addSearch("Off", { enabled: false });
    expect(await stop()).toBe("Turn on a search in Settings → Job agent first.");
    await prisma().agentSearch.update({ where: { id: search.id }, data: { enabled: true, query: { ...query, country: "" } } });
    expect(await stop()).toBe("Give a search what to look for and a country in Settings → Job agent first.");
    await prisma().agentSearch.update({ where: { id: search.id }, data: { query } });
    fake.ai = false;
    expect(await stop()).toBe("Choose an AI provider in Settings → AI provider first.");
    fake.ai = true;
    fake.sources = [];
    expect(await stop()).toBe("Choose a job source in Settings → Job search first.");
    // It never searches the Bundesagentur für Arbeit on its own (#223).
    fake.sources = ["ARBEITSAGENTUR"];
    expect(await stop()).toBe("The job agent doesn't search the Bundesagentur für Arbeit. Choose JSearch, Adzuna or FreeHire in Settings → Job search for it.");
    expect(fake.searches).toBe(0);
    expect((await loadSettings()).agentRuns).toEqual([]);
  });

  it("asks every search on its sources, the Bundesagentur für Arbeit never, and takes from each search in turn", async () => {
    fake.sources = ["JSEARCH", "ADZUNA", "ARBEITSAGENTUR"];
    await addSearch("Leads", { keywords: "Tech lead", sources: ["ADZUNA"] });
    fake.postings = [];
    fake.pages = null;
    const { searchPostings } = await import("@/lib/job-search");
    vi.mocked(searchPostings).mockImplementation(async (source, _credentials, asked) => {
      fake.searches += 1;
      fake.asked.push({ source, keywords: asked.keywords, next: null });
      const titles = asked.keywords === "Tech lead" ? ["Tech Lead A", "Tech Lead B"] : ["Designer 1", "Designer 2", "Designer 3"];
      return { postings: titles.map((title, index) => posting(`${source}-${title}`, title, `2026-10-1${9 - index}T00:00:00Z`, { source, url: "" , company: `${source} ${title}` })), next: null };
    });
    await saveSettings({ agentMaxScores: 4 });
    const scoredTitles: string[] = [];
    fake.onScore = (title) => scoredTitles.push(title);
    await runAgentScan({ manual: false }, context(), now);
    vi.mocked(searchPostings).mockReset();
    expect(fake.asked.map((entry) => [entry.keywords, entry.source])).toEqual([
      ["Product designer", "JSEARCH"],
      ["Product designer", "ADZUNA"],
      ["Tech lead", "ADZUNA"],
    ]);
    // One from each search in turn, newest first in each.
    expect(scoredTitles).toEqual(["Designer 1", "Tech Lead A", "Designer 1", "Tech Lead B"]);
    expect((await loadSettings()).agentRequests.map((request) => request.source).sort()).toEqual(["ADZUNA", "ADZUNA", "JSEARCH"]);
  });

  it("follows a source's next pages, up to the page limit, until it has enough new postings", async () => {
    const titled = (from: number) => Array.from({ length: 10 }, (_, index) => posting(`p${from + index}`, `Designer ${from + index}`, "2026-10-19T00:00:00Z"));
    fake.pages = { "1": titled(0), "2": titled(10), "3": titled(20), "4": titled(30) };
    await saveSettings({ agentMaxScores: 30, agentMaxPages: 3, jobSourceBudgets: { JSEARCH: 5, ADZUNA: 3, FREEHIRE: null } });
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(fake.asked.map((entry) => entry.next)).toEqual([null, "2", "3"]);
    expect(result).toMatchObject({ found: 30, scored: 30 });
    expect((await loadSettings()).agentRequests).toHaveLength(3);
  });

  it("asks a source no more than its budget allows, and goes on with the others", async () => {
    fake.sources = ["JSEARCH", "FREEHIRE"];
    await saveSettings({ jobSourceBudgets: { JSEARCH: 1, ADZUNA: 3, FREEHIRE: null } });
    await runAgentScan({ manual: true }, context(), now);
    const second = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 10 * 60_000));
    expect(fake.asked.map((entry) => entry.source)).toEqual(["JSEARCH", "FREEHIRE", "FREEHIRE"]);
    expect(second.message).toBe("No new postings this time.");
    expect((await loadSettings()).agentRuns[0].searches).toEqual([
      expect.objectContaining({ source: "JSEARCH", error: "JSearch has used its 1 requests for the past 24 hours." }),
      expect.objectContaining({ source: "FREEHIRE", error: null }),
    ]);
  });

  it("holds each source's budget from its own record, whatever the task-data sweep deletes", async () => {
    await saveSettings({ jobRetentionHours: 1 });
    for (const hours of [0, 2, 4]) {
      // Each run's Job row, as the runner leaves it, which the sweep deletes an hour later.
      const at = new Date(now.getTime() + hours * hour);
      await prisma().job.create({ data: { type: "agent-scan", key: "agent", status: "DONE", input: { manual: true }, finishedAt: at } });
      await runAgentScan({ manual: true }, context(), at);
      await sweepFinishedJobs(new Date(now.getTime() + (hours + 1.5) * hour));
    }
    expect(fake.searches).toBe(3);
    expect(await prisma().job.count()).toBe(0);
    const fourth = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 6 * hour));
    expect(fourth.message).toBe("Every job source has used its requests for the past 24 hours. Try again in 18 hours.");
    expect(fake.searches).toBe(3);
    // A day after the first, one may go again.
    await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 24 * hour + 60_000));
    expect(fake.searches).toBe(4);
  });

  it("records each request before it's sent, so a failing source still counts", async () => {
    const { searchPostings } = await import("@/lib/job-search");
    vi.mocked(searchPostings).mockRejectedValueOnce(new Error("socket hang up"));
    await expect(runAgentScan({ manual: false }, context(), now)).rejects.toThrow("socket hang up");
    const settings = await loadSettings();
    expect(settings.agentRuns).toEqual([{ at: now.toISOString(), manual: false, message: null, searches: [] }]);
    expect(settings.agentRequests).toEqual([{ source: "JSEARCH", at: expect.any(String) }]);
  });

  it("goes on when one score fails, and says what failed when none worked", async () => {
    fake.failOn = "Product Designer";
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ scored: 2 });
    expect((await prisma().agentCandidate.findMany()).map((candidate) => candidate.externalId).sort()).toEqual(["a", "c"]);

    await prisma().agentCandidate.deleteMany();
    fake.postings = [page[1]];
    const failed = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(failed).toMatchObject({ scored: 0, message: "The model's answer didn't come back in the expected shape. Try again." });
  });

  it("stops between postings when it's cancelled", async () => {
    const abort = new AbortController();
    fake.onScore = () => abort.abort();
    const result = await runAgentScan({ manual: false }, context(abort), now);
    expect(result.scored).toBeLessThanOrEqual(1);
    expect(await prisma().agentCandidate.count()).toBeLessThanOrEqual(1);
  });

  it("queues drafts for the best new postings when auto-draft is on, up to the cap (#197)", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    vi.mocked(startJob).mockClear();
    expect((await runAgentScan({ manual: false }, context(), now)).drafted).toBe(0);
    expect(startJob).not.toHaveBeenCalled();

    await prisma().agentCandidate.deleteMany();
    await saveSettings({ agentAutoDraft: true, agentMaxDrafts: 1 });
    const result = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(result).toMatchObject({ scored: 3, drafted: 1, message: "2 new postings are waiting for a look. Preparing a draft for the best one." });
    const best = await prisma().agentCandidate.findFirstOrThrow({ where: { externalId: "a" } });
    expect(startJob).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "agent-draft" }), { candidateId: best.id }, { key: `agent-candidate:${best.id}` });
  });

  it("takes startups from Startups too when asked, in turn with the searches, and drafts from their own text (#222)", async () => {
    const make = (externalId: string, company: string, score: number, extra: Record<string, unknown> = {}) =>
      prisma().startup.create({
        data: { source: "YC", externalId, company, website: `https://${externalId}.example`, summary: `${company} builds tools.`, details: "We hire designers.", roles: ["Product Designer"], emails: [], links: [], reasons: [], score, postedAt: new Date("2026-10-19T12:00:00Z"), ...extra },
      });
    const good = await make("acme", "Acme", 80);
    await make("weak", "Weak", 20);
    await make("busy", "Busy", 90, { noApplicationsFrom: "https://busy.example/jobs" });
    await saveSettings({ agentStartups: true, agentStartupMinMatch: 50, startupsLastRefresh: { at: now.toISOString(), added: 0, sources: [], emailsFound: 0 } });

    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ found: 4, scored: 4 });
    const startup = await prisma().agentCandidate.findFirstOrThrow({ where: { source: "STARTUP" } });
    expect(startup).toMatchObject({ externalId: good.id, startupId: good.id, company: "Acme", title: "Product Designer", url: "https://acme.example", complete: true });
    expect(startup.description).toContain("We hire designers.");
    // Not in Find jobs' scores.
    expect(await prisma().postingScore.count({ where: { source: "STARTUP" } })).toBe(0);

    // It doesn't come back, and needs no search when Startups is on.
    await prisma().agentSearch.deleteMany();
    expect(await runAgentScan({ manual: true }, context(), new Date(now.getTime() + hour))).toMatchObject({ found: 0, message: "The searches found no postings this time." });
  });

  it("says when nothing reached the minimum score", async () => {
    fake.postings = [page[2]];
    expect((await runAgentScan({ manual: false }, context(), now)).message).toBe("Scored 1 new posting; none reached your minimum score of 70.");
    expect(demoProfile().basics.name).toBe("Jane Doe");
  });
});
