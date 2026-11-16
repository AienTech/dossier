import { beforeEach, describe, expect, it, vi } from "vitest";
import { listBackups, writeBackup } from "@/lib/backups";
import { loadSettings } from "@/lib/settings-data";
import { catchUpNightlyBackup } from "@/lib/backup-schedule";
vi.mock("@/lib/backups", () => ({ listBackups: vi.fn(async () => []), writeBackup: vi.fn(), deleteBackup: vi.fn() }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: vi.fn(async () => ({ nightlyBackup: true })), saveSettings: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { HIREME_BACKUP_RETENTION_DAYS: 14 } }));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
beforeEach(() => { vi.mocked(listBackups).mockResolvedValue([]); vi.mocked(writeBackup).mockClear(); });
function latest(date: Date) { vi.mocked(listBackups).mockResolvedValue([{ name: "hireme-backup-nightly-example.json", modified: date }]); }
describe("worker backup catch-up", () => {
  it("writes a missed backup when the worker returns in the evening", async () => {
    latest(new Date(2026, 10, 12, 16));
    const now = new Date(2026, 10, 13, 16);
    await catchUpNightlyBackup(now);
    expect(writeBackup).toHaveBeenCalledWith("nightly", now);
  });
  it("does not duplicate a backup after a restart the same evening", async () => {
    latest(new Date(2026, 10, 13, 16));
    await catchUpNightlyBackup(new Date(2026, 10, 13, 17));
    expect(writeBackup).not.toHaveBeenCalled();
  });
  it("uses the previous day's due time before 03:00", async () => {
    latest(new Date(2026, 10, 12, 16));
    await catchUpNightlyBackup(new Date(2026, 10, 13, 1));
    expect(writeBackup).not.toHaveBeenCalled();
  });
  it("respects disabled nightly backups", async () => {
    vi.mocked(loadSettings).mockResolvedValueOnce({ nightlyBackup: false } as Awaited<ReturnType<typeof loadSettings>>);
    await catchUpNightlyBackup(new Date(2026, 10, 13, 16));
    expect(writeBackup).not.toHaveBeenCalled();
  });
});
