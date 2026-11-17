import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: {} }));

import { latestDesktopDownload } from "./desktop-download";

describe("latestDesktopDownload", () => {
  it("returns the Mac DMG from the latest release", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        tag_name: "v2.0.12",
        html_url: "https://github.com/Realtime-Coding/HireMe/releases/tag/v2.0.12",
        assets: [{ name: "HireMe-2.0.12-mac-arm64.dmg", browser_download_url: "https://example.com/HireMe.dmg" }],
      }),
    );
    await expect(latestDesktopDownload("mac", fetchImpl)).resolves.toEqual({
      version: "2.0.12",
      url: "https://example.com/HireMe.dmg",
      direct: true,
    });
  });

  it("falls back to the release page when GitHub is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(latestDesktopDownload("mac", fetchImpl)).resolves.toEqual({
      version: null,
      url: "https://github.com/Realtime-Coding/HireMe/releases/latest",
      direct: false,
    });
  });
});
