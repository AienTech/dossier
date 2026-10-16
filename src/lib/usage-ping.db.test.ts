import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSettings, saveSettings } from "@/lib/settings-data";
import { appVersion } from "@/lib/version";
import { createTestClient, resetDatabase } from "@/test/db";

import { pingIfNewDay, sendPing, USAGE_PING_URL, usagePingEnabled, utcDay } from "./usage-ping";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const telemetry = vi.hoisted(() => ({ value: "on" }));
vi.mock("@/lib/env", () => ({ env: { get DOSSIER_TELEMETRY() { return telemetry.value; } } }));

const prisma = () => db.client!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const morning = new Date("2026-10-16T08:00:00Z");
const evening = new Date("2026-10-16T21:00:00Z");
const nextDay = new Date("2026-10-17T00:30:00Z");

/** A fetch that answers every ping with `status` and records what it was sent. */
const answering = (status = 204) => vi.fn<typeof fetch>(async () => new Response(null, { status }));
/** What a recorded fetch was asked to send. */
const sent = (fetchImpl: ReturnType<typeof answering>) =>
  fetchImpl.mock.calls.map(([url, init]) => ({ url, method: init?.method, body: JSON.parse(String(init?.body)) as unknown }));
/** A new server process: it no longer remembers the day in memory. */
const restart = () => delete (globalThis as { usagePingDay?: string }).usagePingDay;

beforeEach(async () => {
  restart();
  telemetry.value = "on";
  await resetDatabase(prisma());
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma().$disconnect());

describe("the usage ping", () => {
  it("is on in production unless DOSSIER_TELEMETRY=off, and never in development or tests", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(usagePingEnabled()).toBe(true);
    telemetry.value = "off";
    expect(usagePingEnabled()).toBe(false);
    telemetry.value = "on";
    vi.stubEnv("NODE_ENV", "development");
    expect(usagePingEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", "test");
    expect(usagePingEnabled()).toBe(false);
  });

  it("counts days in UTC", () => {
    expect(utcDay(new Date("2026-10-16T23:59:59+02:00"))).toBe("2026-10-16");
    expect(utcDay(new Date("2026-10-17T01:00:00+02:00"))).toBe("2026-10-16");
  });

  it("sends nothing and stores nothing while it's off", async () => {
    const fetchImpl = answering();
    expect(await pingIfNewDay({ now: morning, enabled: false, fetchImpl })).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await prisma().setting.count()).toBe(0);
  });

  it("sends only a random install ID and the version, and keeps the ID", async () => {
    const fetchImpl = answering();
    expect(await pingIfNewDay({ now: morning, enabled: true, fetchImpl })).toBe("sent");

    const { usagePingId, usagePingDay } = await loadSettings();
    expect(usagePingId).toMatch(UUID);
    expect(usagePingDay).toBe("2026-10-16");
    expect(sent(fetchImpl)).toEqual([{ url: USAGE_PING_URL, method: "POST", body: { id: usagePingId, version: appVersion } }]);
  });

  it("goes once a day, even across a restart, and the next day with the same ID", async () => {
    const fetchImpl = answering();
    await pingIfNewDay({ now: morning, enabled: true, fetchImpl });
    expect(await pingIfNewDay({ now: evening, enabled: true, fetchImpl })).toBe("skipped");
    restart();
    expect(await pingIfNewDay({ now: evening, enabled: true, fetchImpl })).toBe("skipped");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    expect(await pingIfNewDay({ now: nextDay, enabled: true, fetchImpl })).toBe("sent");
    const [first, second] = sent(fetchImpl);
    expect(second.body).toEqual(first.body);
    expect((await loadSettings()).usagePingDay).toBe("2026-10-17");
  });

  it("sends it once when pages load at the same time", async () => {
    const fetchImpl = answering();
    const results = await Promise.all([1, 2, 3].map(() => pingIfNewDay({ now: morning, enabled: true, fetchImpl })));
    expect(results.toSorted()).toEqual(["sent", "skipped", "skipped"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("doesn't try again the same day when it fails", async () => {
    await saveSettings({ usagePingId: "6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c" });
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await pingIfNewDay({ now: morning, enabled: true, fetchImpl: offline })).toBe("failed");
    restart();
    expect(await pingIfNewDay({ now: evening, enabled: true, fetchImpl: offline })).toBe("skipped");
    expect(offline).toHaveBeenCalledTimes(1);
    expect(await loadSettings()).toMatchObject({ usagePingId: "6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c", usagePingDay: "2026-10-16" });
  });

  it("counts an error answer as not arriving", async () => {
    expect(await sendPing("6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c", answering(503))).toBe(false);
    expect(await sendPing("6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c", answering(204))).toBe(true);
  });
});
