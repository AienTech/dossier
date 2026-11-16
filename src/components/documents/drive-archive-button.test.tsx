import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_BOT_NOTES } from "@/lib/application-bots";
import { getDriveAutoSync, startDriveAutoSync } from "@/lib/google/drive-sync-actions";
import { DriveArchiveButton } from "./drive-archive-button";
vi.mock("@/lib/google/drive-sync-actions", () => ({ startDriveAutoSync: vi.fn(), getDriveAutoSync: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
const stopProtocolNavigation = (event: MouseEvent) => {
  const link = (event.target as Element)?.closest?.("a");
  if (link && /^(grokbot|claude|hireme-bot):/.test(link.href)) event.preventDefault();
};
beforeEach(() => {
  document.addEventListener("click", stopProtocolNavigation);
  vi.clearAllMocks();
  const host = document.createElement("div"); host.id = "hireme-drive-banner"; document.body.appendChild(host);
  vi.mocked(startDriveAutoSync).mockResolvedValue({ ok: true, data: { status: "ready", url: "https://drive.google.com/drive/folders/snapshot", sourceHash: "version-one" } });
  vi.mocked(getDriveAutoSync).mockResolvedValue({ ok: true, data: { status: "ready", url: "https://drive.google.com/drive/folders/snapshot", sourceHash: "version-one" } });
});
afterEach(() => { document.getElementById("hireme-drive-banner")?.remove(); document.removeEventListener("click", stopProtocolNavigation); });

describe("compact application bot controls", () => {
  it("keeps a button-sized selector, removes manual save/inline prompts, and links to job-specific settings", () => {
    render(<DriveArchiveButton applicationId="job-one" defaultBot="openbot" />);
    expect(screen.getByLabelText("Application bot")).toHaveClass("w-[160px]", "h-[34px]");
    expect(screen.queryByRole("button", { name: "Save to Google Drive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bot settings" })).toHaveAttribute("href", "/settings?section=agent&application=job-one#bot-openbot");
  });
  it("copies only the selected bot's preferences, with a ZIP fallback when no Drive packet is available", async () => {
    const user = userEvent.setup(); const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<DriveArchiveButton applicationId="job-one" botNotes={{ ...EMPTY_BOT_NOTES, grok: "Grok preference", openbot: "OpenBot table" }} />);
    await user.selectOptions(screen.getByLabelText("Application bot"), "openbot");
    await user.click(screen.getByRole("button", { name: "Copy bot prompt" }));
    const prompt = write.mock.calls.at(-1)?.[0];
    expect(prompt).toContain("Target bot: OpenBot"); expect(prompt).toContain("OpenBot table"); expect(prompt).not.toContain("Grok preference");
    expect(prompt).toContain(`${window.location.origin}/api/apply-packets/job-one`);
    expect(prompt).toContain("never submit without my explicit OK");
  });
  it("starts Drive saving in the background without any save button click", async () => {
    const user = userEvent.setup(); const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<DriveArchiveButton applicationId="job-one" driveSyncKey="version-one" />);
    await waitFor(() => expect(startDriveAutoSync).toHaveBeenCalledWith({ id: "job-one", retry: false }), { timeout: 2500 });
    expect(await screen.findByRole("link", { name: "Drive packet" })).toHaveAttribute("href", "https://drive.google.com/drive/folders/snapshot");
    await user.click(screen.getByRole("button", { name: "Copy bot prompt" }));
    expect(write).toHaveBeenLastCalledWith(expect.stringContaining("https://drive.google.com/drive/folders/snapshot"));
  });
  it("shows connection failures at the top of the page and allows retry", async () => {
    vi.mocked(startDriveAutoSync).mockResolvedValueOnce({ ok: true, data: { status: "error", error: "Reconnect Google Drive." } });
    render(<DriveArchiveButton applicationId="job-one" driveSyncKey="version-one" />);
    const alert = await screen.findByRole("alert", {}, { timeout: 2500 });
    expect(alert).toHaveTextContent("Reconnect Google Drive."); expect(alert).toHaveClass("bg-red-700");
    expect(alert.parentElement?.id).toBe("hireme-drive-banner");
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry sync" }));
    await waitFor(() => expect(startDriveAutoSync).toHaveBeenLastCalledWith({ id: "job-one", retry: true }), { timeout: 2500 });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
  it("opens a bot immediately with an already-saved Drive packet even when auto-save is disabled", async () => {
    const user = userEvent.setup(); const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<DriveArchiveButton applicationId="job-one" company="Acme" jobTitle="Android Engineer" defaultBot="grok" grokBotId="bot-123" driveSyncKey="version-one" initialDriveSnapshot="https://drive.google.com/drive/folders/saved" autoSave={false} />);
    await user.click(screen.getByText("Apply with bot"));
    const url = new URL(screen.getByRole("link", { name: "Apply with bot" }).getAttribute("href")!);
    expect(url.protocol).toBe("grokbot:"); expect(url.searchParams.get("id")).toBe("bot-123");
    expect(url.searchParams.get("text")).toContain("Drive first: https://drive.google.com/drive/folders/saved");
    expect(url.searchParams.get("text")).toContain("bot-prompt.md");
    expect(write).toHaveBeenCalledWith(expect.stringContaining("https://drive.google.com/drive/folders/saved"));
    expect(startDriveAutoSync).not.toHaveBeenCalled();
  });
  it("opens Claude Desktop with the ZIP source and uses the full clipboard prompt as fallback", async () => {
    const user = userEvent.setup(); const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<DriveArchiveButton applicationId="job-one" defaultBot="claude" autoSave={false} />);
    await user.click(screen.getByText("Apply with bot"));
    const url = new URL(screen.getByRole("link", { name: "Apply with bot" }).getAttribute("href")!);
    expect(url.protocol).toBe("claude:");
    expect(url.searchParams.get("q")).toContain(`${window.location.origin}/api/apply-packets/job-one`);
    expect(write).toHaveBeenCalledWith(expect.stringContaining("## 8. Update this exact job"));
  });
  it("opens the opted-in OpenBot helper with the Drive packet and ZIP fallback", async () => {
    const user = userEvent.setup(); vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<DriveArchiveButton applicationId="job-one" defaultBot="openbot" openbotLaunchMode="mac-helper" driveSyncKey="version-one" initialDriveSnapshot="https://drive.google.com/drive/folders/saved" autoSave={false} />);
    await user.click(screen.getByText("Apply with bot"));
    const link = new URL(screen.getByRole("link", { name: "Apply with bot" }).getAttribute("href")!);
    expect(link.protocol).toBe("hireme-bot:"); expect(link.searchParams.get("message")).toContain("Drive first: https://drive.google.com/drive/folders/saved");
    expect(link.searchParams.get("message")).toContain("/api/apply-packets/job-one");
  });
  it("respects disabled auto-save", async () => {
    render(<DriveArchiveButton applicationId="job-one" driveSyncKey="version-one" autoSave={false} />);
    expect(startDriveAutoSync).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Copy bot prompt" })).toBeEnabled();
  });
});
