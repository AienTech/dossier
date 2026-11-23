import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { loadJobSearchConfig, resolveJobSearchConfig } from "@/lib/job-search/config";
import { portalInfo, rememberInstalledPortals } from "@/lib/job-search/sources";
import { builtInPortal } from "@/lib/portals/built-in";
import { settingsFromRows } from "@/lib/settings";

import WelcomePage from "./page";

vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth/session", () => ({ verifySession: vi.fn() }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => ({ setupGuide: null }) }));
vi.mock("@/lib/ai/config", () => ({
  isAiUsable: async () => false,
  loadAiSettingsView: async () => ({ provider: "LOCAL", baseUrl: "http://localhost:11434" }),
}));
vi.mock("@/lib/job-search/config", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/job-search/config")>(),
  loadJobSearchConfig: vi.fn(),
}));
vi.mock("@/lib/scoring/config", () => ({ loadScoringConfig: async () => ({ scorer: "AI" }) }));
vi.mock("@/lib/settings-views", () => ({ googleView: async () => ({ status: "disconnected" }) }));
vi.mock("@/lib/profile-data", () => ({ loadProfileName: async () => "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./actions", () => ({ saveSetupGuide: vi.fn() }));
vi.mock("./ai-step", () => ({ AiStep: () => null }));
vi.mock("./jobs-step", () => ({ JobsStep: () => null }));
vi.mock("./scoring-step", () => ({ ScoringStep: () => null }));
vi.mock("./google-step", () => ({ GoogleStep: () => null }));
vi.mock("../../(app)/profile/import/profile-import", () => ({ ProfileImport: () => null }));

afterEach(() => rememberInstalledPortals([]));

it("shows an enabled installed portal's name when setup is complete", async () => {
  const custom = { ...builtInPortal("FREEHIRE")!, id: "CUSTOM", name: "Custom Jobs" };
  rememberInstalledPortals([portalInfo(custom)]);
  vi.mocked(loadJobSearchConfig).mockResolvedValue(resolveJobSearchConfig(
    {
      ...settingsFromRows([]),
      portals: {
        FREEHIRE: { on: true, fields: {}, acceptedAt: null },
        CUSTOM: { on: true, fields: {}, acceptedAt: null },
      },
    },
    {},
    undefined,
    [{ config: custom, origin: "file", originUrl: null, reviewed: false, installedAt: new Date(), builtIn: false }],
  ));

  render(await WelcomePage({ params: Promise.resolve({}), searchParams: Promise.resolve({ step: "done" }) }));

  expect(screen.getByRole("heading", { name: "You're all set" })).toBeInTheDocument();
  expect(screen.getByText("FreeHire and Custom Jobs")).toBeInTheDocument();
});
