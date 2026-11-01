import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptApiKey } from "@/lib/ai/api-key";
import { MockProvider } from "@/lib/ai/providers/mock";
import { loadSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../../prisma/seed/built-ins";

import { json, stubFetch } from "@/lib/ai/test-http";
import { decryptSecret, JOB_SOURCE_KEY, TYPESAFE_KEY } from "@/lib/secrets";
import { clearJobSearchCache } from "@/lib/job-search/cache";
import { jsearchV2LastPage } from "@/test/job-search-fixtures";

import {
  addDocumentLanguage,
  addConnectorRedirect,
  disconnectApps,
  removeConnectorRedirect,
  addAiProfile,
  deleteAiProfile,
  listAiModels,
  saveAiProfileName,
  saveAiProvider,
  saveAiTaskProfiles,
  setDefaultAiProfile,
  saveApiKey,
  saveJobSearchDetails,
  saveJobSource,
  saveJobSourceKey,
  saveScorer,
  saveScoringCriteria,
  saveTypesafeKey,
  setConnector,
  testAiConnection,
  testJev,
  testJobSource,
  updateSettings,
} from "./actions";

// The actions run against the test database, signed in.
const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
// The real config and key handling, with a mock model behind them.
const provider = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  createProvider: vi.fn(() => provider.current),
}));

const prisma = () => db.client!;
const settings = () => loadSettings();

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  provider.current = new MockProvider({ model: "qwen2.5:3b", models: ["qwen2.5:3b", "llama3.1:8b"] });
});
afterAll(() => prisma().$disconnect());

const profiles = () => prisma().aiProfile.findMany({ orderBy: { sort: "asc" } });

describe("saveAiProvider", () => {
  it("makes the first profile from the first save and makes it the default (SET-1)", async () => {
    const result = await saveAiProvider({ profileId: null, provider: "LOCAL", baseUrl: " http://ollama:11434 ", model: "qwen2.5:3b" });
    expect(result).toEqual({ ok: true, data: { id: expect.any(String), keyState: "none" } });
    const [saved] = await profiles();
    expect(saved).toMatchObject({ provider: "LOCAL", baseUrl: "http://ollama:11434", model: "qwen2.5:3b" });
    expect((await settings()).aiDefaultProfileId).toBe(saved.id);
  });

  it("removes the key when the provider changes, so it never reaches another server", async () => {
    const created = await saveAiProvider({ profileId: null, provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5" });
    const profileId = created.ok ? created.data.id : null;
    await saveApiKey({ profileId, provider: "ANTHROPIC", change: { action: "set", value: "sk-ant-secret" } });
    await saveAiProvider({ profileId, provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5" });
    expect((await profiles())[0].apiKeyEnc).not.toBeNull();
    expect(await saveAiProvider({ profileId, provider: "OPENAI", baseUrl: "https://llm.example/v1", model: "" })).toMatchObject({ data: { keyState: "none" } });
    expect((await profiles())[0]).toMatchObject({ provider: "OPENAI", model: null, apiKeyEnc: null });
  });

  it("refuses a profile that no longer exists", async () => {
    expect(await saveAiProvider({ profileId: "gone", provider: "LOCAL", baseUrl: "", model: "" })).toMatchObject({ ok: false });
  });
});

describe("saveApiKey", () => {
  it("stores the key encrypted and only says that it's set", async () => {
    const created = await saveAiProvider({ profileId: null, provider: "ANTHROPIC", baseUrl: "", model: "claude-sonnet-5" });
    const profileId = created.ok ? created.data.id : null;
    const result = await saveApiKey({ profileId, provider: "ANTHROPIC", change: { action: "set", value: " sk-ant-secret " } });
    expect(result).toEqual({ ok: true, data: { id: profileId, keyState: "set" } });
    expect(JSON.stringify(result)).not.toContain("sk-ant");
    const { apiKeyEnc } = (await profiles())[0];
    expect(apiKeyEnc).toMatch(/^v1\./);
    expect(decryptApiKey(apiKeyEnc!)).toBe("sk-ant-secret");
  });

  it("saves a profile too when the provider only came from the environment", async () => {
    await saveApiKey({ profileId: null, provider: "ANTHROPIC", change: { action: "set", value: "sk-ant" } });
    expect(await profiles()).toEqual([expect.objectContaining({ provider: "ANTHROPIC" })]);
  });

  it("removes the key only when asked", async () => {
    const created = await saveApiKey({ profileId: null, provider: "ANTHROPIC", change: { action: "set", value: "sk-ant" } });
    const profileId = created.ok ? created.data.id : null;
    expect(await saveApiKey({ profileId, provider: "ANTHROPIC", change: { action: "clear" } })).toMatchObject({ data: { keyState: "none" } });
    expect((await profiles())[0].apiKeyEnc).toBeNull();
  });

  it("refuses an empty key", async () => {
    expect(await saveApiKey({ profileId: null, provider: "ANTHROPIC", change: { action: "set", value: "  " } })).toMatchObject({ ok: false });
  });

  it("keeps each profile's key to itself", async () => {
    const first = await saveApiKey({ profileId: null, provider: "OPENAI", change: { action: "set", value: "sk-one" } });
    const added = await addAiProfile({});
    const secondId = added.ok ? added.data.id : null;
    await saveAiProvider({ profileId: secondId, provider: "OPENAI", baseUrl: "https://other.example/v1", model: "m" });
    await saveApiKey({ profileId: secondId, provider: "OPENAI", change: { action: "set", value: "sk-two" } });
    const keys = Object.fromEntries((await profiles()).map((profile) => [profile.id, decryptApiKey(profile.apiKeyEnc!)]));
    expect(keys).toEqual({ [first.ok ? first.data.id : ""]: "sk-one", [secondId!]: "sk-two" });
  });
});

describe("AI profiles", () => {
  it("adds, chooses per task, and deletes, falling back to the default", async () => {
    const first = await saveAiProvider({ profileId: null, provider: "LOCAL", baseUrl: "", model: "qwen2.5:3b" });
    const firstId = first.ok ? first.data.id : "";
    const added = await addAiProfile({});
    const secondId = added.ok ? added.data.id : "";
    expect(added).toMatchObject({ ok: true, data: { view: { defaultId: firstId, profiles: [{ id: firstId }, { id: secondId }] } } });

    expect(await saveAiTaskProfiles({ scoring: secondId, writing: "unknown" })).toMatchObject({ ok: true, data: { tasks: { scoring: secondId, writing: null } } });
    expect(await setDefaultAiProfile({ profileId: secondId })).toMatchObject({ data: { defaultId: secondId } });

    expect(await deleteAiProfile({ profileId: secondId })).toMatchObject({ ok: true, data: { defaultId: firstId, tasks: { scoring: null } } });
    expect(await settings()).toMatchObject({ aiDefaultProfileId: firstId, aiTaskProfiles: {} });
  });

  it("renames a profile", async () => {
    const created = await saveAiProvider({ profileId: null, provider: "LOCAL", baseUrl: "", model: "" });
    await saveAiProfileName({ profileId: created.ok ? created.data.id : "", name: " Laptop " });
    expect((await profiles())[0].name).toBe("Laptop");
  });
});

describe("testAiConnection and listAiModels", () => {
  it("time a short prompt to the saved provider and list its models (SET-2)", async () => {
    expect(await testAiConnection({ profileId: null })).toEqual({ ok: true, data: { connected: true, model: "qwen2.5:3b", seconds: expect.any(Number) } });
    expect(await listAiModels({ profileId: null })).toEqual({ ok: true, data: { models: ["qwen2.5:3b", "llama3.1:8b"], problem: null } });
  });

  it("report a failure in plain words", async () => {
    provider.current = new MockProvider({ model: null });
    expect(await testAiConnection({ profileId: null })).toEqual({
      ok: true,
      data: { connected: false, message: "Choose a model in Settings → AI provider first." },
    });
  });
});

describe("updateSettings (E10-2, E10-3)", () => {
  it("saves only the settings given", async () => {
    expect(await updateSettings({ creativity: "EXPRESSIVE", strict: false })).toEqual({ ok: true, data: null });
    expect(await settings()).toMatchObject({ creativity: "EXPRESSIVE", strict: false, showDiff: true, paper: "A4" });
  });

  it("goes back to the posting's language with null", async () => {
    await updateSettings({ docLanguage: "Dutch" });
    expect((await settings()).docLanguage).toBe("Dutch");
    await updateSettings({ docLanguage: null });
    expect((await settings()).docLanguage).toBeNull();
  });

  it("refuses settings it doesn't manage, like the API key", async () => {
    expect(await updateSettings({ apiKeyEnc: "x" } as never)).toMatchObject({ ok: false });
    expect(await updateSettings({ paper: "B5" as never })).toMatchObject({ ok: false });
  });
});

describe("addDocumentLanguage (E10-3)", () => {
  it("adds a new language to the list and writes in it", async () => {
    expect(await addDocumentLanguage({ name: " Hebrew " })).toEqual({ ok: true, data: { language: "Hebrew", added: true } });
    expect(await settings()).toMatchObject({ docLanguage: "Hebrew", customLanguages: ["Hebrew"] });
  });

  it("picks a language already in the list, in any case", async () => {
    expect(await addDocumentLanguage({ name: "dutch" })).toEqual({ ok: true, data: { language: "Dutch", added: false } });
    await addDocumentLanguage({ name: "Hebrew" });
    expect(await addDocumentLanguage({ name: "HEBREW" })).toEqual({ ok: true, data: { language: "Hebrew", added: false } });
    expect(await settings()).toMatchObject({ docLanguage: "Hebrew", customLanguages: ["Hebrew"] });
  });
});

describe("job search settings (E14-4)", () => {
  it("turns sources on and off, any number of them, and says what the section shows", async () => {
    expect(await saveJobSource({ source: "JSEARCH", on: true })).toEqual({
      ok: true,
      data: {
        sources: ["JSEARCH"],
        jsearch: { host: "openwebninja", keyState: "none", keyStates: { openwebninja: "none", rapidapi: "none" } },
        adzuna: { appId: "", keyState: "none" },
        arbeitsagentur: { offered: true, acceptedAt: null },
        freehire: { host: "freehire.me" },
      },
    });
    await saveJobSource({ source: "FREEHIRE", on: true });
    expect((await settings()).jobSources).toEqual(["JSEARCH", "FREEHIRE"]);
    await saveJobSource({ source: "JSEARCH", on: false });
    await saveJobSource({ source: "FREEHIRE", on: false });
    expect((await settings()).jobSources).toEqual([]);
    expect(await saveJobSource({ source: "LINKEDIN" as never, on: true })).toMatchObject({ ok: false });
  });

  it("turns the Bundesagentur für Arbeit on only with its note accepted (#223)", async () => {
    expect(await saveJobSource({ source: "ARBEITSAGENTUR", on: true })).toEqual({
      ok: false,
      error: "Tick “I understand” under the note about the Bundesagentur für Arbeit first.",
    });
    expect((await settings()).jobSources).toBeNull();
    const saved = await saveJobSource({ source: "ARBEITSAGENTUR", on: true, accepted: true });
    expect(saved).toMatchObject({ ok: true, data: { sources: ["ARBEITSAGENTUR"], arbeitsagentur: { offered: true, acceptedAt: expect.any(String) } } });
    const { jobSources, arbeitsagenturAcceptedAt } = await settings();
    expect(jobSources).toEqual(["ARBEITSAGENTUR"]);
    expect(Date.parse(arbeitsagenturAcceptedAt!)).toBeGreaterThan(Date.now() - 60_000);
    // Once accepted, turning it on again needs no second tick.
    await saveJobSource({ source: "ARBEITSAGENTUR", on: false });
    expect(await saveJobSource({ source: "ARBEITSAGENTUR", on: true })).toMatchObject({ ok: true });
  });

  it("stores each key encrypted, JSearch's per host, and only says it's set", async () => {
    await saveJobSource({ source: "JSEARCH", on: true });
    const result = await saveJobSourceKey({ source: "JSEARCH", change: { action: "set", value: " ak_secret " } });
    expect(result).toMatchObject({ ok: true, data: { jsearch: { keyState: "set" } } });
    expect(JSON.stringify(result)).not.toContain("ak_secret");
    const stored = (await settings()).jsearchKeyEnc!;
    expect(stored).not.toContain("ak_secret");
    expect(decryptSecret(JOB_SOURCE_KEY, stored)).toBe("ak_secret");

    const rapid = await saveJobSourceKey({ source: "JSEARCH", host: "rapidapi", change: { action: "set", value: "rk_secret" } });
    expect(rapid).toMatchObject({ ok: true, data: { jsearch: { host: "openwebninja", keyStates: { openwebninja: "set", rapidapi: "set" } } } });
    expect(decryptSecret(JOB_SOURCE_KEY, (await settings()).jsearchRapidapiKeyEnc!)).toBe("rk_secret");

    await saveJobSource({ source: "ADZUNA", on: true });
    await saveJobSearchDetails({ adzunaAppId: " app-1 " });
    await saveJobSourceKey({ source: "ADZUNA", change: { action: "set", value: "adz" } });
    await saveJobSource({ source: "ADZUNA", on: false });
    expect(await settings()).toMatchObject({ jobSources: ["JSEARCH"], adzunaAppId: "app-1", jsearchKeyEnc: stored });

    await saveJobSourceKey({ source: "JSEARCH", change: { action: "clear" } });
    expect((await settings()).jsearchKeyEnc).toBeNull();
    await saveJobSearchDetails({ adzunaAppId: "" });
    expect((await settings()).adzunaAppId).toBeNull();
  });

  it("saves which JSearch host is asked first", async () => {
    expect(await saveJobSearchDetails({ jsearchHost: "rapidapi" })).toMatchObject({ ok: true, data: { jsearch: { host: "rapidapi" } } });
    expect((await settings()).jsearchHost).toBe("rapidapi");
  });

  it("tests a source with its key, JSearch with one host's", async () => {
    clearJobSearchCache();
    await saveJobSource({ source: "JSEARCH", on: true });
    expect(await testJobSource({ source: "JSEARCH" })).toEqual({
      ok: true,
      data: { connected: false, message: "Add your JSearch key in Settings → Job search first." },
    });

    await saveJobSourceKey({ source: "JSEARCH", change: { action: "set", value: "ak_secret" } });
    const requests = stubFetch(() => json(jsearchV2LastPage));
    expect(await testJobSource({ source: "JSEARCH" })).toEqual({ ok: true, data: { connected: true, seconds: expect.any(Number) } });
    expect(requests[0].headers.get("x-api-key")).toBe("ak_secret");
    expect(await testJobSource({ source: "JSEARCH", host: "rapidapi" })).toEqual({
      ok: true,
      data: { connected: false, message: "Add your JSearch key for RapidAPI first." },
    });

    stubFetch(() => json({}, { status: 401 }));
    expect(await testJobSource({ source: "JSEARCH" })).toEqual({
      ok: true,
      data: { connected: false, message: "JSearch didn't accept your key. Check it in Settings → Job search." },
    });
    vi.unstubAllGlobals();
  });

  it("falls back to the other JSearch host when the first refuses its key", async () => {
    clearJobSearchCache();
    await saveJobSource({ source: "JSEARCH", on: true });
    await saveJobSourceKey({ source: "JSEARCH", change: { action: "set", value: "ak_spent" } });
    await saveJobSourceKey({ source: "JSEARCH", host: "rapidapi", change: { action: "set", value: "rk_fresh" } });
    const requests = stubFetch((request) => (request.headers.get("x-api-key") === "ak_spent" ? json({}, { status: 429 }) : json(jsearchV2LastPage)));
    const { runSearch } = await import("@/lib/posting-searches");
    expect(await runSearch({ keywords: "designer", place: "", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" })).toMatchObject({ ok: true });
    expect(requests.map((request) => request.url.hostname)).toEqual(["api.openwebninja.com", "jsearch.p.rapidapi.com"]);
    expect(requests[1].headers.get("x-rapidapi-key")).toBe("rk_fresh");
    vi.unstubAllGlobals();
  });
});

describe("scoring criteria", () => {
  it("saves what the user wants from a job, and refuses one that's empty", async () => {
    const criteria = [{ id: "a", label: "Salary", preference: "At least 80k EUR", importance: "MUST" as const }];
    expect(await saveScoringCriteria({ criteria })).toEqual({ ok: true, data: criteria });
    expect((await settings()).scoringCriteria).toEqual(criteria);
    expect(await saveScoringCriteria({ criteria: [{ ...criteria[0], label: " " }] })).toMatchObject({ ok: false });
  });
});

describe("scoring settings (#274)", () => {
  it("saves the scorer, and the TypeSafe key encrypted for it only", async () => {
    expect(await saveScorer({ scorer: "JEV" })).toEqual({ ok: true, data: { scorer: "JEV", keyState: "none" } });
    expect(await saveTypesafeKey({ change: { action: "set", value: " ts_secret " } })).toEqual({ ok: true, data: { scorer: "JEV", keyState: "set" } });
    const saved = await settings();
    expect(saved.scorer).toBe("JEV");
    expect(saved.typesafeKeyEnc).not.toContain("ts_secret");
    expect(decryptSecret(TYPESAFE_KEY, saved.typesafeKeyEnc!)).toBe("ts_secret");
    expect(() => decryptSecret(JOB_SOURCE_KEY, saved.typesafeKeyEnc!)).toThrow();

    expect(await saveTypesafeKey({ change: { action: "clear" } })).toEqual({ ok: true, data: { scorer: "JEV", keyState: "none" } });
    expect((await settings()).typesafeKeyEnc).toBeNull();
    expect(await saveScorer({ scorer: "AI" })).toMatchObject({ ok: true, data: { scorer: "AI" } });
  });

  it("tests Jev with the saved key, with one short question", async () => {
    expect(await testJev({})).toEqual({ ok: true, data: { connected: false, message: "Enter your TypeSafe key in Settings → Scoring first." } });

    await saveTypesafeKey({ change: { action: "set", value: "ts_secret" } });
    const requests = stubFetch(() => json({ model: "jev-1.14.0", answers: { check: { type: "noul", noul: 0.98 } } }));
    expect(await testJev({})).toEqual({ ok: true, data: { connected: true, model: "jev-1.14.0", seconds: expect.any(Number) } });
    expect(requests[0].url.href).toBe("https://api.typesafe.ai/v1/systemone");
    expect(requests[0].headers.get("authorization")).toBe("Bearer ts_secret");
    expect(requests[0].body).toMatchObject({ model: "jev-latest", questions: { check: { type: "noul" } } });

    stubFetch(() => json({}, { status: 401 }));
    expect(await testJev({})).toEqual({ ok: true, data: { connected: false, message: "TypeSafe didn't accept the key. Check it in Settings → Scoring." } });
    vi.unstubAllGlobals();
  });
});

describe("the MCP connector (#221, #281)", () => {
  it("turns on with the time it did, which every token carries, and off again", async () => {
    expect(await disconnectApps({})).toEqual({ ok: false, error: "The MCP connector is off already." });
    expect(await setConnector({ on: true })).toEqual({ ok: true, data: { on: true } });
    const since = (await settings()).connectorEnabledAt;
    expect(Date.parse(since!)).toBeGreaterThan(Date.now() - 60_000);

    // Disconnect all apps: a new time, so every token stops working.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await disconnectApps({})).toMatchObject({ ok: true, toast: "Every app is disconnected. Connect again from an app to use Dossier there." });
    expect((await settings()).connectorEnabledAt).not.toBe(since);

    await setConnector({ on: false });
    expect((await settings()).connectorEnabledAt).toBeNull();
  });

  it("keeps other apps' callback addresses, once each, and refuses one that isn't safe", async () => {
    const n8n = "https://n8n.example/rest/oauth2-credential/callback";
    expect(await addConnectorRedirect({ uri: ` ${n8n} ` })).toEqual({ ok: true, data: { redirects: [n8n] } });
    expect(await addConnectorRedirect({ uri: n8n })).toEqual({ ok: true, data: { redirects: [n8n] } });
    expect(await addConnectorRedirect({ uri: "http://n8n.example/callback" })).toEqual({
      ok: false,
      error: "Use an https:// address, or http:// only for an app on this computer or your own network.",
    });
    expect(await addConnectorRedirect({ uri: "http://localhost:5678/callback" })).toMatchObject({ ok: true, data: { redirects: [n8n, "http://localhost:5678/callback"] } });
    expect((await settings()).connectorRedirects).toEqual([n8n, "http://localhost:5678/callback"]);
    expect(await removeConnectorRedirect({ uri: n8n })).toEqual({ ok: true, data: { redirects: ["http://localhost:5678/callback"] } });
  });
});
