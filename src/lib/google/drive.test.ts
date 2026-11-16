import { EMPTY_BOT_NOTES } from "@/lib/application-bots";
import { zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildApplyPacket } from "@/lib/apply-packet";
import { loadSettings } from "@/lib/settings-data";
import { googleFetch } from "./account";
import { archiveApplicationToDrive, hiremeDriveFolder } from "./drive";

vi.mock("@/lib/apply-packet", () => ({ buildApplyPacket: vi.fn() }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: vi.fn(async () => ({ driveShareLinks: false })) }));
vi.mock("./account", () => ({ googleFetch: vi.fn() }));
vi.mock("./endpoints", () => ({ googleUrl: (_host: string, path: string) => `https://www.googleapis.com${path}` }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildApplyPacket).mockResolvedValue({
    packet: { dir: "Example-Engineer-2026-11-14", folderName: "Example-Engineer-2026-11-14", files: ["resume.pdf", "application.md", "instructions.md", "bot-prompt.md"], answers: { location: "", expectedSalary: "", experience: "" } },
    promptContext: { input: { applicationId: "app1", applicationUrl: "https://hireme.example/applications/app1", company: "Example", jobTitle: "Engineer", promptTemplate: "Packet for {{company}}: {{drive_url}}" }, notes: EMPTY_BOT_NOTES },
    zip: zipSync({ "Example-Engineer-2026-11-14": {
      "resume.pdf": new Uint8Array([37, 80, 68, 70, 255, 0]),
      "application.md": new TextEncoder().encode("# Application"),
      "instructions.md": new TextEncoder().encode("Wait for approval"),
      "bot-prompt.md": new TextEncoder().encode("ZIP prompt"),
    } }),
  });
  let snapshot = 0;
  vi.mocked(googleFetch).mockImplementation(async (_group, url, init) => {
    const parsed = new URL(url);
    if (!init?.method) return { files: [{ id: parsed.searchParams.get("q")?.includes("value='root'") ? "root-id" : "app-id" }] } as never;
    if (init?.method === "POST" && !init.media) return { id: `snapshot-${++snapshot}` } as never;
    return { id: "file-id" } as never;
  });
});

describe("Drive application archive", () => {
  it("reuses the app's tagged root, leaving unrelated same-name folders alone", async () => {
    expect(await hiremeDriveFolder()).toEqual({ id: "root-id", url: "https://drive.google.com/drive/folders/root-id" });
    const query = new URL(vi.mocked(googleFetch).mock.calls[0][1]).searchParams.get("q");
    expect(query).toContain("appProperties has");
    expect(query).toContain("trashed = false");
    expect(googleFetch).toHaveBeenCalledTimes(1);
  });

  it("creates a HireMe folder when not previously set up", async () => {
    vi.mocked(googleFetch).mockResolvedValueOnce({ files: [] }).mockResolvedValueOnce({ id: "new-root" });
    expect((await hiremeDriveFolder()).id).toBe("new-root");
    expect(googleFetch).toHaveBeenLastCalledWith("drive", expect.any(String), expect.objectContaining({
      method: "POST", body: { name: "HireMe", mimeType: "application/vnd.google-apps.folder", parents: ["root"], appProperties: { hiremeFolder: "root" } },
    }));
  });

  it("appends snapshots with exact binary PDFs and instructions, without changing sharing", async () => {
    const first = await archiveApplicationToDrive("app1");
    const second = await archiveApplicationToDrive("app1");
    expect(first.url).not.toBe(second.url);
    const calls = vi.mocked(googleFetch).mock.calls;
    const uploads = calls.filter(([, url]) => String(url).includes("/upload/"));
    expect(uploads).toHaveLength(8);
    for (const [group, url, init] of uploads) {
      expect(group).toBe("drive");
      expect(String(url)).toContain("uploadType=multipart");
      expect(init?.media?.contentType).toContain("multipart/related; boundary=hireme_");
    }
    const body = Buffer.from(await (uploads[0][2]?.media?.body as Blob).arrayBuffer());
    expect(body.includes(Buffer.from([37, 80, 68, 70, 255, 0]))).toBe(true);
    expect(body.toString()).toContain('"parents":["snapshot-1"]');
    expect(body.toString()).toContain("application/pdf");
    expect(calls.some(([, url]) => String(url).includes("permissions"))).toBe(false);
    const promptUpload = await (uploads[3][2]?.media?.body as Blob).text();
    expect(promptUpload).toContain('"name":"bot-prompt.md"');
    expect(promptUpload).toContain("Packet for Example: https://drive.google.com/drive/folders/snapshot-1");
    expect(promptUpload).toContain("https://hireme.example/api/apply-packets/app1");
    expect(promptUpload).toContain("never submit without my explicit OK");
    const patches = calls.filter(([, , init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(JSON.stringify(patches)).not.toContain("incomplete");
  });

  it("shares only the finished snapshot folder when link sharing is on", async () => {
    vi.mocked(loadSettings).mockResolvedValueOnce({ driveShareLinks: true } as never);
    await archiveApplicationToDrive("app1");
    const calls = vi.mocked(googleFetch).mock.calls;
    const shares = calls.filter(([, url]) => String(url).includes("/permissions"));
    expect(shares).toHaveLength(1);
    // The snapshot folder, never the HireMe or application folder above it.
    expect(String(shares[0][1])).toContain("/files/snapshot-1/permissions");
    expect(shares[0][2]).toMatchObject({ method: "POST", body: { role: "reader", type: "anyone", allowFileDiscovery: false } });
    // Sharing happens after the "(incomplete)" name is removed, so a partial
    // upload is never readable.
    const patch = calls.findIndex(([, , init]) => init?.method === "PATCH");
    expect(patch).toBeGreaterThan(-1);
    expect(calls.indexOf(shares[0])).toBeGreaterThan(patch);
  });

  it("creates a readable application folder while using its stable ID only as private metadata", async () => {
    vi.mocked(googleFetch).mockResolvedValueOnce({ files: [{ id: "root-id" }] }).mockResolvedValueOnce({ files: [] }).mockResolvedValueOnce({ id: "application-folder" });
    await archiveApplicationToDrive("app1");
    expect(googleFetch).toHaveBeenCalledWith("drive", expect.any(String), expect.objectContaining({ method: "POST", body: { name: "Example-Engineer-2026-11-14", mimeType: "application/vnd.google-apps.folder", appProperties: { hiremeFolder: "app1" }, parents: ["root-id"] } }));
  });

  it("renames an older ID folder in place and preserves its snapshots", async () => {
    vi.mocked(googleFetch).mockResolvedValueOnce({ files: [{ id: "root-id", name: "HireMe" }] }).mockResolvedValueOnce({ files: [{ id: "old-app-folder", name: "app1" }] });
    await archiveApplicationToDrive("app1");
    expect(googleFetch).toHaveBeenCalledWith("drive", expect.stringContaining("/files/old-app-folder?"), { method: "PATCH", body: { name: "Example-Engineer-2026-11-14" } });
    const snapshot = vi.mocked(googleFetch).mock.calls.find(([, , init]) => init?.method === "POST" && !init.media);
    expect(snapshot?.[2]?.body).toMatchObject({ parents: ["old-app-folder"] });
    expect(vi.mocked(googleFetch).mock.calls.some(([, , init]) => init?.method === "DELETE")).toBe(false);
  });

  it("does not touch Drive if PDF generation fails", async () => {
    vi.mocked(buildApplyPacket).mockRejectedValueOnce(new Error("PDF failed"));
    await expect(archiveApplicationToDrive("app1")).rejects.toThrow("PDF failed");
    expect(googleFetch).not.toHaveBeenCalled();
  });

  it("leaves failed snapshots marked incomplete, without claiming success", async () => {
    vi.mocked(googleFetch).mockImplementation(async (_group, _url, init) => {
      if (!init?.method) return { files: [{ id: "existing" }] } as never;
      if (init.media) throw new Error("Drive quota exceeded");
      return { id: "snapshot" } as never;
    });
    await expect(archiveApplicationToDrive("app1")).rejects.toThrow("Drive quota exceeded");
    expect(vi.mocked(googleFetch).mock.calls.some(([, , init]) => init?.method === "PATCH")).toBe(false);
    const create = vi.mocked(googleFetch).mock.calls.find(([, , init]) => init?.method === "POST");
    expect(JSON.stringify(create?.[2]?.body)).toContain("incomplete");
  });
});
