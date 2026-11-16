import { beforeEach, expect, it, vi } from "vitest";
import { googleConnection } from "@/lib/google/account";
import { loadSettings } from "@/lib/settings-data";
import InboxPage from "./page";
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/google/account", () => ({ googleConnection: vi.fn() }));
vi.mock("@/lib/google/inbox-data", () => ({ loadInbox: async () => ({ waiting: [], unmatched: [], updates: [] }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { application: { findMany: async () => [] } } }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: vi.fn() }));
vi.mock("@/lib/time-zone", () => ({ userTimeZone: async () => "UTC" }));
vi.mock("./inbox-screen", () => ({ InboxScreen: () => null }));
beforeEach(() => {
  vi.mocked(loadSettings).mockResolvedValue({ gmailRead: false } as Awaited<ReturnType<typeof loadSettings>>);
  vi.mocked(googleConnection).mockResolvedValue({ status: "connected", email: "owner@example.com", canRead: true, canSend: true, canUseCalendar: true, canArchiveDrive: true, lastSyncAt: null, syncProblem: null, signInProblem: null });
});
it("keeps Gmail connected when only automatic checks are disabled", async () => {
  const view = await InboxPage();
  expect(view.props).toMatchObject({ connected: true, googleEmail: "owner@example.com", automaticSync: false, gmailPermissionMissing: false });
});
it("distinguishes a Drive-only connection from a disconnected Google account", async () => {
  vi.mocked(googleConnection).mockResolvedValue({ status: "connected", email: "owner@example.com", canRead: false, canSend: false, canUseCalendar: false, canArchiveDrive: true, lastSyncAt: null, syncProblem: null, signInProblem: null });
  const view = await InboxPage();
  expect(view.props).toMatchObject({ connected: false, configured: true, gmailPermissionMissing: true, googleEmail: "owner@example.com" });
});
