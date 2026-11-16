import { describe, expect, it } from "vitest";
import { applicationPacketName } from "./application-packet-name";

describe("application packet names", () => {
  it("uses company, role and a stable UTC creation date", () => {
    expect(applicationPacketName("Acme", "Android Engineer", "2026-11-14T01:00:00+05:00")).toBe("Acme-Android-Engineer-2026-11-13");
  });
  it("removes path separators, unsafe characters and empty path segments", () => {
    const name = applicationPacketName("../../ACME / Cloud", "Senior\\Engineer:*?", "2026-11-14");
    expect(name).toBe("ACME-Cloud-Senior-Engineer-2026-11-14");
    expect(applicationPacketName("", "...", "2026-11-14")).toBe("Company-Application-2026-11-14");
  });
});
