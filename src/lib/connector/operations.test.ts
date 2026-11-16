import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/env", () => ({ env: {} }));
import { settingsPatch, basicsPatch } from "./routine";
import { errorCategory } from "./operations";
import { snapshotDigest } from "./approvals";
import { recordSubmission } from "./submission";
describe("delegated input boundaries", () => {
  it("allows useful settings but refuses secrets, credential destinations and security controls", () => {
    expect(settingsPatch.safeParse({ model: "deepseek-flash", agentHour: 21, strict: true }).success).toBe(true);
    for (const input of [{ apiKeyEnc: "secret" }, { HIREME_SECRET: "secret" }, { baseUrl: "https://attacker.example" }, { provider: "OPENAI" }, { connectorEnabledAt: null }, { googleClientSecretEnc: "secret" }, { nightlyBackup: false }]) expect(settingsPatch.safeParse(input).success).toBe(false);
    expect(basicsPatch.safeParse({ email: "owner@example.com", summary: "Facts from the user" }).success).toBe(true);
    expect(basicsPatch.safeParse({ permissions: ["email_request"] }).success).toBe(false);
  });
  it("never puts raw provider errors or keys in job monitoring results", () => {
    for (const message of ["Authorization Bearer secret-super-private", "API key sk-super-private failed", "Failed input containing secret-super-private"]) expect(errorCategory(message)).not.toContain("super-private");
  });
  it("hashes review snapshots identically after PostgreSQL JSON key reordering", () => {
    expect(snapshotDigest({ a: 1, nested: { z: 2, b: 3 } })).toBe(snapshotDigest({ nested: { b: 3, z: 2 }, a: 1 }));
    expect(snapshotDigest({ to: "a@example.com" })).not.toBe(snapshotDigest({ to: "b@example.com" }));
  });
  it("requires an actual date for confirmed submissions and rejects duplicate document kinds", () => {
    const base = { idempotency_key: "one", company: "Acme", role: "Engineer", source: "bot", confirmed: true };
    expect(recordSubmission.safeParse(base).success).toBe(false);
    expect(recordSubmission.safeParse({ ...base, confirmed: false }).success).toBe(true);
    expect(recordSubmission.safeParse({ ...base, submitted_at: "2026-11-13T06:00:00Z", documents: [{ kind: "resume", text: "A" }, { kind: "resume", text: "B" }] }).success).toBe(false);
  });
});
