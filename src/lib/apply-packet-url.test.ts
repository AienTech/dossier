import { describe, expect, it } from "vitest";

import { APPLY_PACKET_PASSWORD_PARAM, applyPacketPath, applyPacketUrl } from "./apply-packet-url";

describe("apply packet URLs", () => {
  it("builds a relative path without a password", () => {
    expect(applyPacketPath("app1")).toBe("/api/apply-packets/app1");
  });

  it("appends an encoded password query when configured", () => {
    expect(applyPacketPath("app1", "p@ss word")).toBe(
      `/api/apply-packets/app1?${APPLY_PACKET_PASSWORD_PARAM}=p%40ss%20word`,
    );
  });

  it("builds an absolute URL and strips a trailing slash on the origin", () => {
    expect(applyPacketUrl("https://hireme.example/", "job-one", "secret")).toBe(
      "https://hireme.example/api/apply-packets/job-one?password=secret",
    );
  });
});
