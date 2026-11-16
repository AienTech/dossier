import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewBotPrompt } from "@/lib/bot-prompt-actions";
import { EMPTY_BOT_NOTES } from "@/lib/application-bots";
import { saveApplyBot, saveApplyBotNotes, saveApplyBotPromptTemplate, saveOpenbotLaunchMode } from "./actions";
import { ApplicationBotsSection } from "./application-bots-section";

vi.mock("@/lib/bot-prompt-actions", () => ({ previewBotPrompt: vi.fn() }));
vi.mock("./actions", () => ({
  saveApplyBot: vi.fn(async () => ({ ok: true, data: { applyBot: "openbot" } })),
  saveGrokAgentName: vi.fn().mockResolvedValue({ ok: true }),
  saveGrokLaunchMode: vi.fn().mockResolvedValue({ ok: true }),
  saveOpenbotAgentName: vi.fn(async () => ({ ok: true, data: { value: "Job Manager" } })),
  saveOpenbotLaunchMode: vi.fn(async () => ({ ok: true, data: { value: "mac-helper" } })),
  saveApplyBotPromptTemplate: vi.fn(async () => ({ ok: true, data: { value: "" } })),
  saveApplyBotNotes: vi.fn(async () => ({ ok: true, data: { bot: "openbot", value: "" } })),
  saveGrokBotId: vi.fn(async () => ({ ok: true, data: { grokBotId: null } })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe("Application bots settings", () => {
  it("shows configuration for all bots together and changes the default", async () => {
    const user = userEvent.setup();
    render(<ApplicationBotsSection applyBot="grok" grokBotId="saved-bot" notes={EMPTY_BOT_NOTES} />);
    for (const name of ["Grok Bot", "OpenBot", "Claude", "Other bot"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(screen.getByLabelText("Grok Bot id (optional)")).toHaveValue("saved-bot");
    expect(screen.getByRole("link", { name: "Set up MCP access" })).toHaveAttribute("href", "/settings?section=connector");
    await user.selectOptions(screen.getByLabelText("Default application bot"), "openbot");
    expect(saveApplyBot).toHaveBeenCalledWith({ value: "openbot" });
    expect(screen.getByLabelText("Default application bot")).toHaveValue("openbot");
  });

  it("saves OpenBot preferences separately from the Grok preferences", async () => {
    const user = userEvent.setup();
    render(<ApplicationBotsSection applyBot="grok" grokBotId={null} notes={{ ...EMPTY_BOT_NOTES, grok: "Grok-specific preference" }} />);
    await user.type(screen.getByLabelText("OpenBot handoff preferences"), "Show a compact review table");
    await user.tab();
    await waitFor(() => expect(saveApplyBotNotes).toHaveBeenCalledWith({ bot: "openbot", value: "Show a compact review table" }));
    expect(screen.getByLabelText("Grok Bot handoff preferences")).toHaveValue("Grok-specific preference");
    expect(saveApplyBotNotes).not.toHaveBeenCalledWith(expect.objectContaining({ bot: "grok" }));
  });

  it("previews the selected real job and hides its prompt after changing preferences", async () => {
    vi.mocked(previewBotPrompt).mockResolvedValueOnce({ ok: true, data: { prompt: "OpenBot packet for application job-one, Drive first, ZIP fallback" } });
    const user = userEvent.setup();
    render(<ApplicationBotsSection applyBot="openbot" grokBotId={null} notes={EMPTY_BOT_NOTES} applications={[{ id: "job-one", company: "Example", role: "Engineer", title: "Engineer" }]} selectedApplicationId="job-one" />);
    await user.click(screen.getByRole("button", { name: "Preview OpenBot prompt" }));
    expect(previewBotPrompt).toHaveBeenCalledWith({ id: "job-one", bot: "openbot", notes: "", template: "" });
    expect(await screen.findByLabelText("OpenBot full application prompt")).toHaveValue("OpenBot packet for application job-one, Drive first, ZIP fallback");
    await user.type(screen.getByLabelText("OpenBot handoff preferences"), "New preference");
    expect(screen.queryByLabelText("OpenBot full application prompt")).not.toBeInTheDocument();
  });

  it("auto-saves one shared template and uses its current value in the selected job preview", async () => {
    vi.mocked(previewBotPrompt).mockResolvedValue({ ok: true, data: { prompt: "Engineer at Example" } });
    const user = userEvent.setup();
    render(<ApplicationBotsSection applyBot="openbot" grokBotId={null} notes={EMPTY_BOT_NOTES} selectedApplicationId="job-one" />);
    const template = screen.getByLabelText("Prompt template (optional)");
    await user.click(template);
    await user.paste("Apply to {{role}} at {{company}}");
    await user.tab();
    await waitFor(() => expect(saveApplyBotPromptTemplate).toHaveBeenCalledWith({ value: "Apply to {{role}} at {{company}}" }));
    await user.click(screen.getByRole("button", { name: "Preview OpenBot prompt" }));
    expect(previewBotPrompt).toHaveBeenCalledWith({ id: "job-one", bot: "openbot", notes: "", template: "Apply to {{role}} at {{company}}" });
    await screen.findByLabelText("OpenBot full application prompt");
    await user.clear(template);
    expect(screen.queryByLabelText("OpenBot full application prompt")).not.toBeInTheDocument();
  });

  it("saves the OpenBot helper opt-in separately from the default bot and template", async () => {
    render(<ApplicationBotsSection applyBot="openbot" grokBotId={null} notes={EMPTY_BOT_NOTES} />);
    await userEvent.setup().selectOptions(screen.getByLabelText("OpenBot handoff"), "mac-helper");
    await waitFor(() => expect(saveOpenbotLaunchMode).toHaveBeenCalledWith({ value: "mac-helper" }));
    expect(screen.getByRole("link", { name: "Test installed helper" })).toHaveAttribute("href", expect.stringContaining("hireme-bot://openbot/apply?"));
    expect(saveApplyBot).not.toHaveBeenCalled();
  });

  it("restores the previous default if saving fails", async () => {
    vi.mocked(saveApplyBot).mockResolvedValueOnce({ ok: false, error: "Offline" });
    render(<ApplicationBotsSection applyBot="grok" grokBotId={null} notes={EMPTY_BOT_NOTES} />);
    await userEvent.setup().selectOptions(screen.getByLabelText("Default application bot"), "openbot");
    await waitFor(() => expect(screen.getByLabelText("Default application bot")).toHaveValue("grok"));
  });
});
