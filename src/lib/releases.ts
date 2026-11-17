// Where HireMe's releases are published, for the update check and its
// notice (update-check.ts, the sidebar). Safe to use in the browser.

export const RELEASES_REPOSITORY = "Realtime-Coding/HireMe";
/** The repository's page, for credits and support (the sidebar). */
export const REPOSITORY_URL = `https://github.com/${RELEASES_REPOSITORY}`;
/** How to update, in the wiki. */
export const UPGRADE_GUIDE_URL = `${REPOSITORY_URL}/wiki/Upgrading`;
/** Latest GitHub release page (assets and notes). */
export const LATEST_RELEASE_URL = `${REPOSITORY_URL}/releases/latest`;

/** A published release: its version, without the "v", and its page on GitHub. */
export type Release = { version: string; url: string };

/** Desktop installer kinds we publish on a release. */
export type DesktopAssetKind = "mac" | "windows" | "deb" | "appimage";

const DESKTOP_ASSET: Record<DesktopAssetKind, RegExp> = {
  mac: /-mac-.*\.dmg$/i,
  windows: /-win-x64\.exe$/i,
  deb: /-linux-amd64\.deb$/i,
  appimage: /-linux-x86_64\.AppImage$/i,
};

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

/** Picks a desktop asset download URL from a GitHub release payload. */
export function desktopAssetUrl(
  assets: { name?: unknown; browser_download_url?: unknown }[] | undefined,
  kind: DesktopAssetKind,
): string | null {
  const match = assets?.find((asset) => typeof asset.name === "string" && DESKTOP_ASSET[kind].test(asset.name));
  return match && typeof match.browser_download_url === "string" ? match.browser_download_url : null;
}
