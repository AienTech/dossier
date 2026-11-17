import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ HIREME_APPLY_PACKET_PASSWORD: undefined as string | undefined }));

vi.mock("@/lib/env", () => ({ env: config }));

import { isApplyPacketPassword, applyPacketPasswordConfigured } from "./apply-packet-access";

beforeEach(() => {
  config.HIREME_APPLY_PACKET_PASSWORD = undefined;
});

describe("apply packet password access", () => {
  it("is off when the env password is unset", () => {
    expect(applyPacketPasswordConfigured()).toBe(false);
    const request = new Request("https://hireme.example/api/apply-packets/app1?password=anything");
    expect(isApplyPacketPassword(request)).toBe(false);
  });

  it("accepts the password in the query or header", () => {
    config.HIREME_APPLY_PACKET_PASSWORD = "packet-secret";
    expect(applyPacketPasswordConfigured()).toBe(true);
    expect(isApplyPacketPassword(new Request("https://hireme.example/api/apply-packets/app1?password=packet-secret"))).toBe(true);
    expect(
      isApplyPacketPassword(
        new Request("https://hireme.example/api/apply-packets/app1", {
          headers: { "x-hireme-apply-packet-password": "packet-secret" },
        }),
      ),
    ).toBe(true);
  });

  it("rejects a wrong or missing password", () => {
    config.HIREME_APPLY_PACKET_PASSWORD = "packet-secret";
    expect(isApplyPacketPassword(new Request("https://hireme.example/api/apply-packets/app1"))).toBe(false);
    expect(isApplyPacketPassword(new Request("https://hireme.example/api/apply-packets/app1?password=wrong"))).toBe(false);
  });
});
