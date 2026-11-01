import { describe, expect, it, vi } from "vitest";

import { encryptSecret, JOB_SOURCE_KEY } from "@/lib/secrets";

import { arbeitsagenturStartupNotice, credentialsFor, jobSearchView, requestContext, resolveJobSearchConfig } from "./config";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

const nothingSaved = {
  jobSources: null,
  jsearchKeyEnc: null,
  jsearchRapidapiKeyEnc: null,
  jsearchHost: "openwebninja" as const,
  adzunaAppId: null,
  adzunaKeyEnc: null,
  arbeitsagenturAcceptedAt: null,
};
const ACCEPTED = "2026-10-23T09:00:00.000Z";
const noEnv = {};

describe("resolveJobSearchConfig", () => {
  it("is off until a source is chosen", () => {
    const config = resolveJobSearchConfig(nothingSaved, noEnv);
    expect(config).toMatchObject({ sources: [], saved: false, jsearch: { key: null, keyState: "none" }, adzuna: { appId: "", key: null } });
    expect(jobSearchView(config)).toEqual({
      sources: [],
      jsearch: { host: "openwebninja", keyState: "none", keyStates: { openwebninja: "none", rapidapi: "none" } },
      adzuna: { appId: "", keyState: "none" },
      arbeitsagentur: { offered: true, acceptedAt: null },
      freehire: { host: "freehire.me" },
    });
  });

  it("uses the environment until something is saved", () => {
    const config = resolveJobSearchConfig(nothingSaved, {
      DOSSIER_JOBS_SOURCE: ["jsearch", "adzuna"],
      DOSSIER_JSEARCH_KEY: "ak_env",
      DOSSIER_JSEARCH_HOST: "rapidapi",
      DOSSIER_ADZUNA_APP_ID: "app-env",
      DOSSIER_ADZUNA_KEY: "adz-env",
    });
    expect(config).toMatchObject({
      sources: ["JSEARCH", "ADZUNA"],
      saved: false,
      jsearch: { key: "ak_env", host: "rapidapi", keyState: "env" },
      adzuna: { appId: "app-env", key: "adz-env", keyState: "env" },
    });
    expect(resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: ["off"] }).sources).toEqual([]);
  });

  it("prefers what's saved, Off included, and decrypts saved keys", () => {
    const saved = {
      jobSources: ["ADZUNA" as const],
      jsearchKeyEnc: encryptSecret(JOB_SOURCE_KEY, "ak_saved"),
      jsearchRapidapiKeyEnc: null,
      jsearchHost: "openwebninja" as const,
      adzunaAppId: "app-saved",
      adzunaKeyEnc: encryptSecret(JOB_SOURCE_KEY, "adz-saved"),
      arbeitsagenturAcceptedAt: null,
    };
    const config = resolveJobSearchConfig(saved, { DOSSIER_JOBS_SOURCE: ["jsearch"], DOSSIER_JSEARCH_KEY: "ak_env", DOSSIER_JSEARCH_HOST: "rapidapi" });
    expect(config).toMatchObject({
      sources: ["ADZUNA"],
      saved: true,
      // The environment's key belongs to its host, RapidAPI, and stands in when OpenWeb Ninja refuses.
      jsearch: { key: "ak_saved", host: "openwebninja", keyState: "set", fallback: { key: "ak_env", host: "rapidapi" } },
      adzuna: { appId: "app-saved", key: "adz-saved", keyState: "set" },
    });
    expect(resolveJobSearchConfig({ ...saved, jobSources: [] }, { DOSSIER_JOBS_SOURCE: ["jsearch"] })).toMatchObject({ sources: [], saved: true });
  });

  it("says when a saved key can't be read, rather than using another", () => {
    const config = resolveJobSearchConfig(
      { ...nothingSaved, jobSources: ["JSEARCH"], jsearchKeyEnc: encryptSecret(JOB_SOURCE_KEY, "ak", "b".repeat(32)) },
      { DOSSIER_JSEARCH_KEY: "ak_env" },
    );
    expect(config.jsearch).toEqual({ key: null, host: "openwebninja", keyState: "unreadable", keyStates: { openwebninja: "unreadable", rapidapi: "none" }, fallback: null });
    expect(() => credentialsFor(config, "JSEARCH")).toThrow("Your saved JSearch key can't be read. Enter it again in Settings → Job search.");
  });
});

describe("credentialsFor", () => {
  const config = resolveJobSearchConfig(
    { ...nothingSaved, jobSources: ["JSEARCH"], jsearchRapidapiKeyEnc: encryptSecret(JOB_SOURCE_KEY, "ak_saved"), jsearchHost: "rapidapi" },
    noEnv,
  );

  it("gives each source its own key", () => {
    expect(credentialsFor(config, "JSEARCH")).toEqual({ key: "ak_saved", host: "rapidapi" });
    expect(credentialsFor({ ...config, arbeitsagentur: { offered: true, acceptedAt: ACCEPTED } }, "ARBEITSAGENTUR")).toEqual({});
    expect(credentialsFor(config, "FREEHIRE")).toEqual({});
  });

  it("asks JSearch's first host first, with the other as the fallback", () => {
    const both = { ...nothingSaved, jsearchKeyEnc: encryptSecret(JOB_SOURCE_KEY, "ak_own"), jsearchRapidapiKeyEnc: encryptSecret(JOB_SOURCE_KEY, "ak_rapid") };
    expect(credentialsFor(resolveJobSearchConfig({ ...both, jsearchHost: "rapidapi" }, noEnv), "JSEARCH")).toEqual({
      key: "ak_rapid",
      host: "rapidapi",
      fallback: { key: "ak_own", host: "openwebninja" },
    });
    // Only the other host has a key: it's asked first.
    expect(credentialsFor(resolveJobSearchConfig({ ...both, jsearchKeyEnc: null }, noEnv), "JSEARCH")).toEqual({ key: "ak_rapid", host: "rapidapi" });
  });

  it("says what's missing", () => {
    expect(() => credentialsFor(config, "ADZUNA")).toThrow("Add your Adzuna app ID and key in Settings → Job search first.");
    expect(() => credentialsFor(resolveJobSearchConfig(nothingSaved, noEnv), "JSEARCH")).toThrow("Add your JSearch key in Settings → Job search first.");
    const keyOnly = resolveJobSearchConfig({ ...nothingSaved, adzunaKeyEnc: encryptSecret(JOB_SOURCE_KEY, "adz") }, noEnv);
    expect(() => credentialsFor(keyOnly, "ADZUNA")).toThrow(/app ID and key/);
  });
});

describe("the Bundesagentur für Arbeit (#223)", () => {
  const chosen = { ...nothingSaved, jobSources: ["ARBEITSAGENTUR" as const] };

  it("isn't searched until its note is accepted", () => {
    const waiting = resolveJobSearchConfig(chosen, noEnv);
    expect(waiting).toMatchObject({ sources: ["ARBEITSAGENTUR"], arbeitsagentur: { offered: true, acceptedAt: null } });
    expect(() => credentialsFor(waiting, "ARBEITSAGENTUR")).toThrow(
      expect.objectContaining({ problem: "not-accepted", message: "Read the note about Bundesagentur für Arbeit and tick “I understand” before Dossier searches it." }),
    );
    const accepted = resolveJobSearchConfig({ ...chosen, arbeitsagenturAcceptedAt: ACCEPTED }, noEnv);
    expect(credentialsFor(accepted, "ARBEITSAGENTUR")).toEqual({});
  });

  it("is off everywhere when the server turns it off, a saved choice included", () => {
    const off = resolveJobSearchConfig({ ...chosen, arbeitsagenturAcceptedAt: ACCEPTED }, { DOSSIER_JOBS_ARBEITSAGENTUR: "off" });
    expect(off).toMatchObject({ sources: [], saved: true, arbeitsagentur: { offered: false } });
    expect(jobSearchView(off)).toMatchObject({ sources: [], arbeitsagentur: { offered: false, acceptedAt: ACCEPTED } });
    // A saved BA posting doesn't fetch its text either.
    expect(() => credentialsFor(off, "ARBEITSAGENTUR")).toThrow(expect.objectContaining({ problem: "off" }));
    // Other sources aren't touched.
    expect(resolveJobSearchConfig({ ...chosen, jobSources: ["JSEARCH", "ARBEITSAGENTUR"] }, { DOSSIER_JOBS_ARBEITSAGENTUR: "off" }).sources).toEqual(["JSEARCH"]);
  });

  it("logs its note at start when DOSSIER_JOBS_SOURCE chooses it", () => {
    const fromEnv = resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: ["arbeitsagentur"] });
    expect(arbeitsagenturStartupNotice(fromEnv)).toMatch(
      /^Job search: DOSSIER_JOBS_SOURCE chooses the Bundesagentur für Arbeit\. The Bundesagentur für Arbeit has no official API\..* It isn't searched until you tick “I understand” in Settings → Job search\.$/,
    );
    const acceptedFromEnv = resolveJobSearchConfig({ ...nothingSaved, arbeitsagenturAcceptedAt: ACCEPTED }, { DOSSIER_JOBS_SOURCE: ["arbeitsagentur"] });
    expect(arbeitsagenturStartupNotice(acceptedFromEnv)).not.toMatch(/isn't searched/);
    // Chosen in Settings, or another source: nothing to log.
    expect(arbeitsagenturStartupNotice(resolveJobSearchConfig(chosen, noEnv))).toBeNull();
    expect(arbeitsagenturStartupNotice(resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: ["jsearch"] }))).toBeNull();
  });
});

describe("requestContext", () => {
  it("leaves sources at their own address, unless the end-to-end tests point them at a fake", () => {
    expect(requestContext("JSEARCH", undefined)).toEqual({});
    expect(requestContext("ADZUNA", "http://127.0.0.1:3998/")).toEqual({ baseUrl: "http://127.0.0.1:3998/adzuna" });
    expect(requestContext("FREEHIRE", undefined, "https://jobs.example")).toEqual({ baseUrl: "https://jobs.example" });
    expect(requestContext("FREEHIRE", "http://127.0.0.1:3998/", "https://jobs.example")).toEqual({
      baseUrl: "http://127.0.0.1:3998/freehire",
    });
  });
});

describe("FreeHire from the environment", () => {
  it("chooses FreeHire when DOSSIER_JOBS_SOURCE says so", () => {
    expect(resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: ["freehire"] }).sources).toEqual(["FREEHIRE"]);
  });

  it("searches freehire.me, or the self-hosted FreeHire DOSSIER_FREEHIRE_URL names", () => {
    expect(resolveJobSearchConfig(nothingSaved, noEnv).freehire).toEqual({ url: "https://freehire.me" });
    const own = resolveJobSearchConfig(nothingSaved, { DOSSIER_FREEHIRE_URL: "https://jobs.example:8443" });
    expect(own.freehire).toEqual({ url: "https://jobs.example:8443" });
    expect(jobSearchView(own).freehire).toEqual({ host: "jobs.example:8443" });
  });
});
