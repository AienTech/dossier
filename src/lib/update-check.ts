import "server-only";

import { appVersion } from "@/lib/version";

// "Check for updates" (E10-9, SET-12, PRD §11): only when clicked, and all it
// sends is a request for the project's latest GitHub release.

export const RELEASES_REPOSITORY = "AienTech/dossier";

export type UpdateCheck =
  | { status: "latest"; version: string }
  | { status: "newer"; version: string; url: string }
  | { status: "unknown" };

/** 1.10.0 is newer than 1.9.2; anything after "-" (a pre-release) is ignored. */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (version: string) => version.replace(/^v/i, "").split("-")[0].split(".").map((part) => Number(part) || 0);
  const [a, b] = [parts(candidate), parts(current)];
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/**
 * Asks GitHub for the latest release. While the repository or its releases
 * aren't public, GitHub answers 404 and the check says it couldn't tell
 * (decided 28 September 2026).
 */
export async function checkForUpdate(fetchImpl: typeof fetch = fetch, current = appVersion): Promise<UpdateCheck> {
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${RELEASES_REPOSITORY}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "Dossier" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) return { status: "unknown" };
    const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
    if (typeof release.tag_name !== "string") return { status: "unknown" };
    const version = release.tag_name.replace(/^v/i, "");
    return isNewer(version, current) && typeof release.html_url === "string"
      ? { status: "newer", version, url: release.html_url }
      : { status: "latest", version: current };
  } catch {
    return { status: "unknown" };
  }
}
