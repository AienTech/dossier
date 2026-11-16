import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSession } from "@/lib/auth/session";
import { accessToken } from "./account";
import { archiveApplicationToDrive } from "./drive";
import { saveApplicationToDrive } from "./drive-actions";
import { GoogleError } from "./errors";
import { prisma } from "@/lib/prisma";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { note: { create: vi.fn() } } }));
vi.mock("./account", () => ({ accessToken: vi.fn() }));
vi.mock("./drive", () => ({ archiveApplicationToDrive: vi.fn(), hiremeDriveFolder: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue({ persistent: false, issuedAt: new Date(), expiresAt: new Date() });
  vi.mocked(accessToken).mockResolvedValue("access");
  vi.mocked(archiveApplicationToDrive).mockResolvedValue({ url: "https://drive.google.com/drive/folders/snapshot", files: ["resume.pdf"] });
});

describe("Drive archive action", () => {
  it("requires a signed-in owner before doing external work", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await saveApplicationToDrive({ id: "app1" })).ok).toBe(false);
    expect(accessToken).not.toHaveBeenCalled();
    expect(archiveApplicationToDrive).not.toHaveBeenCalled();
  });

  it("requires Drive consent before generating or uploading files", async () => {
    vi.mocked(accessToken).mockRejectedValueOnce(new GoogleError("scope", "Allow Drive in Settings → Google."));
    expect(await saveApplicationToDrive({ id: "app1" })).toEqual({ ok: false, error: "Allow Drive in Settings → Google." });
    expect(archiveApplicationToDrive).not.toHaveBeenCalled();
    expect(prisma.note.create).not.toHaveBeenCalled();
  });

  it("saves the archive link in the application history after success", async () => {
    expect((await saveApplicationToDrive({ id: "app1" })).ok).toBe(true);
    expect(prisma.note.create).toHaveBeenCalledWith({ data: { applicationId: "app1", body: expect.stringContaining("https://drive.google.com/drive/folders/snapshot") } });
  });
});
