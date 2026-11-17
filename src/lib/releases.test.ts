import { describe, expect, it } from "vitest";

import { desktopAssetUrl, isNewer } from "./releases";

describe("desktopAssetUrl", () => {
  const assets = [
    { name: "HireMe-2.0.3-mac-arm64.dmg", browser_download_url: "https://example.com/mac.dmg" },
    { name: "HireMe-2.0.3-mac-arm64.zip", browser_download_url: "https://example.com/mac.zip" },
    { name: "HireMe-2.0.3-win-x64.exe", browser_download_url: "https://example.com/win.exe" },
  ];

  it("picks the Mac DMG", () => {
    expect(desktopAssetUrl(assets, "mac")).toBe("https://example.com/mac.dmg");
  });

  it("picks the Windows installer", () => {
    expect(desktopAssetUrl(assets, "windows")).toBe("https://example.com/win.exe");
  });

  it("returns null when the asset is missing", () => {
    expect(desktopAssetUrl(assets, "deb")).toBeNull();
  });
});

describe("isNewer", () => {
  it("compares dotted versions", () => {
    expect(isNewer("2.0.10", "2.0.9")).toBe(true);
    expect(isNewer("2.0.1", "2.0.10")).toBe(false);
  });
});
