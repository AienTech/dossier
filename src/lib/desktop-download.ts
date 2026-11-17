import "server-only";

import { env } from "@/lib/env";
import { desktopAssetUrl, LATEST_RELEASE_URL, RELEASES_REPOSITORY, type DesktopAssetKind } from "@/lib/releases";

/** Where to send someone for a desktop install when GitHub has no matching asset yet. */
export type DesktopDownload = {
  version: string | null;
  /** Direct asset URL when known, else the latest release page. */
  url: string;
  /** True when `url` is a direct DMG/exe/deb/AppImage. */
  direct: boolean;
};

/**
 * Latest desktop installer for this kind from GitHub releases. Falls back to
 * the release page when the asset is missing or GitHub is unreachable.
 */
export async function latestDesktopDownload(
  kind: DesktopAssetKind = "mac",
  fetchImpl: typeof fetch = fetch,
  base = env.HIREME_UPDATES_TEST_BASE_URL,
): Promise<DesktopDownload> {
  try {
    const response = await fetchImpl(`${base ?? "https://api.github.com"}/repos/${RELEASES_REPOSITORY}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "HireMe" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) return { version: null, url: LATEST_RELEASE_URL, direct: false };
    const release = (await response.json()) as {
      tag_name?: unknown;
      html_url?: unknown;
      assets?: { name?: unknown; browser_download_url?: unknown }[];
    };
    const version = typeof release.tag_name === "string" ? release.tag_name.replace(/^v/i, "") : null;
    const direct = desktopAssetUrl(release.assets, kind);
    if (direct) return { version, url: direct, direct: true };
    if (typeof release.html_url === "string" && release.html_url.startsWith(`https://github.com/${RELEASES_REPOSITORY}/`)) {
      return { version, url: release.html_url, direct: false };
    }
  } catch {
    // Fall through to the release page.
  }
  return { version: null, url: LATEST_RELEASE_URL, direct: false };
}
