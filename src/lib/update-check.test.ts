import { describe, expect, it, vi } from "vitest";

import { checkForUpdate, isNewer } from "./update-check";

const answer = (status: number, body: unknown) => vi.fn(async () => Response.json(body, { status }));

describe("isNewer", () => {
  it("compares versions number by number", () => {
    expect(isNewer("1.10.0", "1.9.2")).toBe(true);
    expect(isNewer("v0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0-beta", "0.1.0")).toBe(false);
    expect(isNewer("0.0.9", "0.1.0")).toBe(false);
  });
});

describe("checkForUpdate (E10-9)", () => {
  it("asks for the latest release and nothing else", async () => {
    const fetch = answer(200, { tag_name: "v0.1.0", html_url: "https://github.com/AienTech/dossier/releases/tag/v0.1.0" });
    expect(await checkForUpdate(fetch, "0.1.0")).toEqual({ status: "latest", version: "0.1.0" });
    expect(fetch).toHaveBeenCalledWith("https://api.github.com/repos/AienTech/dossier/releases/latest", expect.objectContaining({ cache: "no-store" }));
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method ?? "GET").toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("offers a newer version with its page", async () => {
    const fetch = answer(200, { tag_name: "v0.2.0", html_url: "https://github.com/AienTech/dossier/releases/tag/v0.2.0" });
    expect(await checkForUpdate(fetch, "0.1.0")).toEqual({
      status: "newer",
      version: "0.2.0",
      url: "https://github.com/AienTech/dossier/releases/tag/v0.2.0",
    });
  });

  it("can't tell while releases aren't public, or offline", async () => {
    expect(await checkForUpdate(answer(404, { message: "Not Found" }), "0.1.0")).toEqual({ status: "unknown" });
    expect(await checkForUpdate(vi.fn(async () => Promise.reject(new TypeError("fetch failed"))), "0.1.0")).toEqual({ status: "unknown" });
  });
});
