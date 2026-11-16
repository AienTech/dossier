import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveFile } from "@/lib/save-file";
import { toast } from "@/components/toast";

import { prepareGrokApplyPacket } from "./actions";
import { ApplyWithBot } from "./apply-with-bot";

vi.mock("@/lib/save-file", () => ({ saveFile: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
vi.mock("./actions", () => ({
  prepareGrokApplyPacket: vi.fn(async () => ({
    ok: true,
    data: {
      dir: "/Users/me/Documents/HireMe/apply/app-1",
      files: ["application.md", "instructions.md", "resume.pdf"],
      answers: {
        location: "Lisbon, Portugal",
        expectedSalary: "3,500+ USD/month",
        experience: "8+ years Android/mobile",
      },
    },
  })),
}));

const writeText = vi.fn(async () => undefined);
const open = vi.fn(() => ({ closed: false }));

beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
  open.mockReturnValue({ closed: false });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  vi.stubGlobal("open", open);
});

const base = {
  applicationId: "app-1",
  postingUrl: "https://jobs.example/1",
  company: "Acme",
  role: "Frontend",
  title: "Frontend",
  hasResume: true,
  hasLetter: true,
  applyBot: "grok" as const,
  grokBotId: null as string | null,
  connectorOn: false,
};

describe("ApplyWithBot", () => {
  it("writes a local packet, opens grokbot://, and copies a prompt with that folder path", async () => {
    const user = userEvent.setup();
    render(<ApplyWithBot {...base} />);
    await user.click(screen.getByRole("button", { name: "Apply with bot" }));
    await waitFor(() => expect(prepareGrokApplyPacket).toHaveBeenCalledWith({ id: "app-1" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringMatching(/^grokbot:\/\/app\/v1\/prompt\?/), "_blank", "noopener"));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Materials are in \/Users\/me\/Documents\/HireMe\/apply\/app-1/)),
    );
  });

  it("downloads cloud PDFs before offering a Grok handoff with extraction instructions", async () => {
    vi.mocked(prepareGrokApplyPacket).mockResolvedValueOnce({ ok: true, data: {
      dir: "~/Documents/hireme/apply/app-1", files: [],
      downloadUrl: "/api/apply-packets/app-1", archiveName: "hireme-apply-app-1.zip",
      answers: { location: "Portugal", expectedSalary: "3500 USD", experience: "Android engineer" },
    } });
    const fetcher = vi.fn(async () => new Response(new Blob(["zip bytes"])));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<ApplyWithBot {...base} grokBotId="bot123" />);
    await user.click(screen.getByRole("button", { name: "Apply with bot" }));
    const next = await screen.findByRole("button", { name: "Open Grok Bot" });
    expect(fetcher).toHaveBeenCalledWith("/api/apply-packets/app-1");
    expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), "hireme-apply-app-1.zip");
    expect(open).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Apply prompt") as HTMLTextAreaElement).value).toContain("Extract the ZIP");
    await user.click(next);
    expect(new URL(String(open.mock.calls.at(-1)?.at(0))).searchParams.get("text")).toContain("extract into ~/Documents/hireme/apply/");
  });

  it("keeps Grok closed if the cloud download fails", async () => {
    vi.mocked(prepareGrokApplyPacket).mockResolvedValueOnce({ ok: true, data: {
      dir: "~/Documents/hireme/apply/app-1", files: [], downloadUrl: "/api/apply-packets/app-1",
      answers: { location: "", expectedSalary: "", experience: "" },
    } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "PDF renderer unavailable" }), { status: 500 })));
    const user = userEvent.setup();
    render(<ApplyWithBot {...base} />);
    await user.click(screen.getByRole("button", { name: "Apply with bot" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("PDF renderer unavailable"));
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open Grok Bot" })).not.toBeInTheDocument();
  });

  it("hands OpenBot the shared Drive/ZIP workflow without launching Grok or rendering PDFs", async () => {
    const user = userEvent.setup();
    render(<ApplyWithBot {...base} applyBot="openbot" botInstructions="Use a compact review table" />);
    await user.click(screen.getByRole("button", { name: "Apply with bot" }));
    const prompt = (screen.getByLabelText("Apply prompt") as HTMLTextAreaElement).value;
    expect(prompt).toContain("Target bot: OpenBot");
    expect(prompt).toContain("Use a compact review table");
    expect(prompt).toContain("/api/apply-packets/app-1");
    expect(open).not.toHaveBeenCalled();
    expect(prepareGrokApplyPacket).not.toHaveBeenCalled();
  });

  it("uses an existing Drive packet for Grok before downloading a new ZIP", async () => {
    const user = userEvent.setup();
    render(<ApplyWithBot {...base} snapshotUrl="https://drive.google.com/drive/folders/packet" />);
    await user.click(screen.getByRole("button", { name: "Apply with bot" }));
    expect((screen.getByLabelText("Apply prompt") as HTMLTextAreaElement).value).toContain("https://drive.google.com/drive/folders/packet");
    expect(open).toHaveBeenCalled();
    expect(prepareGrokApplyPacket).not.toHaveBeenCalled();
  });

  it("opens Claude with an apply prompt when Claude is selected and the connector is on", async () => {
    const user = userEvent.setup();
    render(<ApplyWithBot {...base} applyBot="claude" connectorOn />);
    await user.click(screen.getByRole("button", { name: "Apply with bot" }));
    expect(open).toHaveBeenCalled();
    const href = String(open.mock.calls.at(0)?.at(0) ?? "");
    expect(href).toContain("claude.ai/new");
    expect(decodeURIComponent(href)).toContain("app-1");
    expect(prepareGrokApplyPacket).not.toHaveBeenCalled();
  });

  it("asks to turn on the connector when Claude is selected but off", async () => {
    const user = userEvent.setup();
    render(<ApplyWithBot {...base} applyBot="claude" connectorOn={false} />);
    await user.click(screen.getByRole("button", { name: "Apply with bot" }));
    expect(open).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/connector/i));
  });

  it("stays disabled without a posting link", () => {
    render(<ApplyWithBot {...base} postingUrl="" />);
    expect(screen.getByRole("button", { name: "Apply with bot" })).toHaveAttribute("aria-disabled", "true");
  });

  it("toasts when the packet cannot be written", async () => {
    vi.mocked(prepareGrokApplyPacket).mockResolvedValueOnce({ ok: false, error: "Couldn’t write the apply folder." });
    const user = userEvent.setup();
    render(<ApplyWithBot {...base} />);
    await user.click(screen.getByRole("button", { name: "Apply with bot" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Couldn’t write the apply folder."));
    expect(open).not.toHaveBeenCalled();
  });
});
