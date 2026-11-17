import "server-only";

import { env } from "@/lib/env";

import { isDiscovererHost, isLocalDiscovererHost, type DiscovererCompany, type DiscovererProgress } from "./discoverer-host";

export { isDiscovererHost, isLocalDiscovererHost, type DiscovererCompany, type DiscovererProgress } from "./discoverer-host";

/** Whether this install treats FreeHire as the JobSpy discoverer (local or tunnel). */
export function discovererEnabled(): boolean {
  return env.HIREME_DISCOVERER === "on";
}

export function discovererAuthHeaders(): Record<string, string> {
  const token = env.HIREME_DISCOVERER_TOKEN;
  return token ? { "x-hireme-discoverer-token": token } : {};
}

export function discovererBaseUrl(): string | null {
  const url = env.HIREME_FREEHIRE_URL;
  if (!url) return null;
  try {
    const host = new URL(url).host;
    if (!isDiscovererHost(host, discovererEnabled())) return null;
  } catch {
    return null;
  }
  return url.replace(/\/+$/, "");
}

async function discovererFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = discovererBaseUrl();
  if (!base) throw new Error("The local discoverer isn’t configured (HIREME_FREEHIRE_URL).");
  const response = await fetch(`${base}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json", ...discovererAuthHeaders(), ...(init?.headers ?? {}) },
  });
  return response;
}

export async function listDiscovererCompanies(): Promise<DiscovererCompany[]> {
  const response = await discovererFetch("/api/v1/companies");
  if (!response.ok) throw new Error("Couldn’t read the company watchlist from the local discoverer.");
  const body = (await response.json()) as { data?: DiscovererCompany[] };
  return body.data ?? [];
}

export async function addDiscovererCompany(input: { name: string; ats?: string; slug?: string; url?: string }): Promise<DiscovererCompany> {
  const response = await discovererFetch("/api/v1/companies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { data?: DiscovererCompany; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Couldn’t add that company.");
  if (!body.data) throw new Error("Couldn’t add that company.");
  return body.data;
}

export async function removeDiscovererCompany(id: string): Promise<void> {
  const response = await discovererFetch(`/api/v1/companies/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Couldn’t remove that company.");
  }
}

export async function discovererScrapeStatus(): Promise<DiscovererProgress> {
  const response = await discovererFetch("/api/v1/scrape/status");
  if (!response.ok) throw new Error("Couldn’t read scrape progress.");
  return (await response.json()) as DiscovererProgress;
}

export async function startDiscovererScrape(opts: { resume?: boolean; forceNew?: boolean } = {}): Promise<DiscovererProgress> {
  const response = await discovererFetch("/api/v1/scrape/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resume: Boolean(opts.resume), force_new: Boolean(opts.forceNew) }),
  });
  if (!response.ok) throw new Error("Couldn’t start the scrape.");
  return (await response.json()) as DiscovererProgress;
}

export async function pauseDiscovererScrape(): Promise<DiscovererProgress> {
  const response = await discovererFetch("/api/v1/scrape/pause", { method: "POST" });
  if (!response.ok) throw new Error("Couldn’t pause the scrape.");
  return (await response.json()) as DiscovererProgress;
}

/** Fast liveness check for Settings → Test connection. */
export async function pingDiscoverer(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
    headers: { accept: "application/json", ...discovererAuthHeaders() },
  });
  if (!response.ok) throw new Error(`health HTTP ${response.status}`);
  const body = (await response.json()) as { ok?: boolean; discoverer?: boolean };
  if (!body.ok) throw new Error("health not ok");
}
