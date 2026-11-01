import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { countAgentQueue, loadAgentView } from "./view";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
// Settings → Scoring reads DOSSIER_SCORER (#274).
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/time-zone", () => ({ lastKnownTimeZone: async () => "Europe/Berlin" }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({ sources: ["JSEARCH"], saved: true, jsearch: { key: "k", host: "openwebninja", keyState: "set" }, adzuna: { appId: "", key: null, keyState: "none" } }),
  agentSources: (config: { sources: string[] }) => config.sources,
  credentialsFor: () => ({ key: "k", host: "openwebninja" }),
}));

const prisma = () => db.client!;
const now = new Date("2026-10-20T10:00:00Z");
const candidate = (externalId: string, score: number, data: Record<string, unknown> = {}) =>
  prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId, dedupeKey: externalId, title: `Posting ${externalId}`, company: "Ledgerly", place: "Berlin", remote: true, score, via: "LinkedIn", postedAt: new Date("2026-10-18T00:00:00Z"), ...data } });

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().agentSearch.create({ data: { query: { keywords: "Data scientist", place: "Berlin", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" }, sources: [] } });
  await saveSettings({
    agentEnabled: true,
    agentRuns: [
      {
        at: "2026-10-20T05:00:00Z",
        manual: false,
        message: "2 new postings are waiting for a look.",
        searches: [{ searchId: "s", searchName: "Data scientist · Berlin, 25 km", source: "JSEARCH", found: 10, fresh: 2, error: null }],
      },
    ],
  });
});
afterAll(() => prisma().$disconnect());

describe("the Agent screen's data (E16-6)", () => {
  it("splits the queue into drafts, scored postings and those below the minimum, best first", async () => {
    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    await candidate("draft", 90, { status: "DRAFTED", applicationId: application.id });
    const good = await candidate("good", 75);
    await prisma().agentCandidateSearch.create({ data: { candidateId: good.id, searchName: "Data scientists" } });
    const startup = await prisma().startup.create({
      data: { source: "YC", externalId: "acme", company: "Acme", roles: [], links: [], reasons: [], emails: [{ email: "jobs@acme.example", label: "Hiring", from: "", onRequest: false, foundAt: "2026-10-18T00:00:00.000Z" }, { email: "ann@acme.example", label: "Person", from: "", onRequest: true, foundAt: "2026-10-18T00:00:00.000Z" }] },
    });
    await candidate("acme", 80, { source: "STARTUP", startupId: startup.id, via: "Y Combinator", scoredWith: "score-posting@3 +criteria:00000000" });
    await candidate("better", 88);
    await candidate("low", 30);
    await candidate("gone", 95, { status: "DISMISSED" });
    await candidate("kept", 95, { status: "APPROVED" });
    const job = await prisma().job.create({ data: { type: "agent-draft", key: `agent-candidate:${good.id}`, input: { candidateId: good.id } } });

    const view = await loadAgentView(now);
    expect(view.drafts.map((entry) => entry.title)).toEqual(["Posting draft"]);
    expect(view.scored.map((entry) => entry.title)).toEqual(["Posting better", "Posting acme", "Posting good"]);
    // A startup: where it's from, where to write, and a score made with criteria since changed.
    expect(view.scored[1]).toMatchObject({ origin: "Posted 2 days ago · From Startups, via Y Combinator", emails: ["jobs@acme.example"], stale: true });
    expect(view.scored[0]).toMatchObject({ emails: [], stale: false });
    expect(view.belowMinimum.map((entry) => entry.title)).toEqual(["Posting low"]);
    expect(view.scored[2]).toMatchObject({ facts: "Berlin · Remote", origin: "Posted 2 days ago · via LinkedIn on JSearch", draftJobId: job.id, foundBy: ["Data scientists"] });
    expect(view).toMatchObject({
      searches: [{ label: "Data scientist · Berlin, 25 km", sources: "JSearch" }],
      setupProblem: null,
      budgets: [{ source: "JSEARCH", name: "JSearch", left: 3, limit: 3, freeAt: null }],
      lastRun: {
        at: "Tue 20 Oct, 07:00",
        message: "2 new postings are waiting for a look.",
        searches: [{ label: "Data scientist · Berlin, 25 km", source: "JSearch", found: 10, fresh: 2, error: null }],
      },
      nextRun: "Wed 21 Oct, 07:00",
    });
    // The badge: scored at or above the minimum, and drafts.
    expect(await countAgentQueue()).toBe(4);
  });

  it("says what's missing, and when a source's requests are used up", async () => {
    await prisma().agentSearch.updateMany({ data: { enabled: false } });
    await saveSettings({ agentEnabled: false });
    expect(await loadAgentView(now)).toMatchObject({
      enabled: false,
      searches: [],
      setupProblem: "Turn on a search in Settings → Job agent first.",
      setupSection: "agent",
      nextRun: null,
    });

    await prisma().agentSearch.updateMany({ data: { enabled: true } });
    await saveSettings({ agentRequests: ["09:30", "08:00", "06:00"].map((time) => ({ source: "JSEARCH" as const, at: `2026-10-20T${time}:00Z` })) });
    expect((await loadAgentView(now)).budgets).toEqual([{ source: "JSEARCH", name: "JSearch", left: 0, limit: 3, freeAt: "Wed 21 Oct, 08:00" }]);
  });
});
