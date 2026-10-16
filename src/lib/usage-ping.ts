import "server-only";

import { randomUUID } from "node:crypto";

import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { appVersion } from "@/lib/version";

// The usage ping: on each day someone
// signed in opens a page, the server sends this install's random ID and the
// app's version, once, so the project can count the installs in use and how
// often they're used. Nothing else is sent. DOSSIER_TELEMETRY=off stops it.
// The receiving end is a Cloudflare Worker, not published with the app.

export const USAGE_PING_HOST = "telemetry.dossier.aien.me";
export const USAGE_PING_URL = `https://${USAGE_PING_HOST}/ping`;

/** Logged once at startup while the ping is on. */
export const USAGE_PING_NOTICE =
  `Usage ping: on each day Dossier is used, it sends ${USAGE_PING_HOST} a random install ID and its version number, once, ` +
  "to count the installs in use. Nothing else is sent. Set DOSSIER_TELEMETRY=off to stop it.";

/** Production servers send it unless DOSSIER_TELEMETRY=off; development servers and tests never do. */
export function usagePingEnabled(): boolean {
  return process.env.NODE_ENV === "production" && env.DOSSIER_TELEMETRY === "on";
}

/** The calendar day in UTC, as the Worker records it: "2026-10-16". */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const globalForPing = globalThis as unknown as { usagePingDay?: string };

type PingOptions = { now?: Date; enabled?: boolean; fetchImpl?: typeof fetch };

/**
 * Sends today's ping unless it has gone already. Past the first page load of
 * the day, it returns without touching the database. The day is saved before
 * sending, so a ping that fails isn't tried again until the next day.
 */
export async function pingIfNewDay({ now = new Date(), enabled = usagePingEnabled(), fetchImpl = fetch }: PingOptions = {}): Promise<"sent" | "failed" | "skipped"> {
  if (!enabled) return "skipped";
  const day = utcDay(now);
  // Set before anything async, so pages loading together don't send it twice.
  if (globalForPing.usagePingDay === day) return "skipped";
  globalForPing.usagePingDay = day;

  // After a restart, the database knows whether today's has gone.
  const settings = await loadSettings();
  if (settings.usagePingDay === day) return "skipped";
  const id = settings.usagePingId ?? randomUUID();
  await saveSettings({ usagePingId: id, usagePingDay: day });
  return (await sendPing(id, fetchImpl)) ? "sent" : "failed";
}

/** One request with the ID and the version; false if it doesn't arrive. Never throws. */
export async function sendPing(id: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(USAGE_PING_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, version: appVersion }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    // Offline, blocked or slow: it tries again on the next day of use, without filling the logs.
    return false;
  }
}

/** Run by the signed-in layout after each page load (see after()). Never throws. */
export async function notePageLoad(): Promise<void> {
  await pingIfNewDay().catch((error: unknown) => logServerError("usage ping", error));
}
