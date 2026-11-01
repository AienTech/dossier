import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { AgentSearch } from "@/lib/agent/searches";

import { deleteAgentSearch, saveAgentSearch, saveAgentSettings } from "../agent/actions";
import { AgentSection, type AgentSettings } from "./agent-section";

vi.mock("../agent/actions", () => ({
  saveAgentSettings: vi.fn(async () => ({ ok: true, data: null })),
  saveAgentSearch: vi.fn(),
  deleteAgentSearch: vi.fn(),
  moveAgentSearch: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean; error?: string }) => (result.ok ? result : (toast(result.error!), result)) }));

const query = { keywords: "Data scientist", place: "Berlin", country: "de", radiusKm: 25 as const, remoteOnly: false, postedWithin: "any" as const };
const search: AgentSearch = { id: "s1", name: "", query, sources: [], enabled: true };
const initial: AgentSettings = {
  enabled: false,
  hour: 7,
  minScore: 70,
  maxScores: 15,
  maxDrafts: 3,
  autoDraft: false,
  maxSearches: 3,
  maxPages: 1,
  budgets: { JSEARCH: 3, ADZUNA: 3, FREEHIRE: null },
  startups: false,
  startupMinMatch: 50,
};
const countries = [
  { code: "de", name: "Germany" },
  { code: "nl", name: "Netherlands" },
];
const open = (props: Partial<Parameters<typeof AgentSection>[0]> = {}) =>
  render(
    <AgentSection
      initial={initial}
      searches={[search]}
      starter={query}
      sources={["JSEARCH", "FREEHIRE"]}
      scoring={{ scorer: "AI", ready: true }}
      countries={countries}
      timeZone="Europe/Berlin"
      {...props}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveAgentSearch).mockImplementation(async (input) => ({ ok: true, data: [{ ...search, ...input, id: input.id ?? "s2" }] }));
  vi.mocked(deleteAgentSearch).mockResolvedValue({ ok: true, data: [] });
});

describe("Settings → Job agent (E16-7)", () => {
  it("is off until it's turned on", async () => {
    const user = userEvent.setup();
    open();
    const toggle = screen.getByRole("switch", { name: "Run the job agent" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription("Off. Nothing is searched or scored until it's on.");
    await user.click(toggle);
    expect(saveAgentSettings).toHaveBeenCalledWith({ enabled: true });
    expect(toggle).toHaveAccessibleDescription(/^On\. It runs once a day after 07:00 your time \(Europe\/Berlin\), and you can run it any time/);
  });

  it("saves a search with Save, on the sources ticked", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText("Name"), "Data");
    await user.click(screen.getByRole("checkbox", { name: "FreeHire" }));
    await user.click(screen.getByRole("button", { name: "Save search" }));
    expect(saveAgentSearch).toHaveBeenCalledWith({ id: "s1", name: "Data", query, sources: ["JSEARCH"], enabled: true });
  });

  it("adds a search from the last one in Find jobs, and needs keywords and a country", async () => {
    const user = userEvent.setup();
    open({ starter: { ...query, keywords: "", country: "" } });
    await user.click(screen.getByRole("button", { name: "Add a search" }));
    const editors = screen.getAllByRole("button", { name: "Save search" });
    await user.click(editors[1]);
    expect(saveAgentSearch).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText("What")[1]).toHaveAccessibleDescription("Type what the search should look for.");
  });

  it("offers no more searches than the limit", () => {
    open({ initial: { ...initial, maxSearches: 1 } });
    expect(screen.getByRole("button", { name: "Add a search" })).toBeDisabled();
  });

  it("deletes a search", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteAgentSearch).toHaveBeenCalledWith({ id: "s1" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save search" })).not.toBeInTheDocument());
  });

  it("saves the other choices at once, and each source's budget", async () => {
    const user = userEvent.setup();
    open();
    await user.selectOptions(screen.getByLabelText("Runs after"), "09:00");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ hour: 9 });
    await user.selectOptions(screen.getByLabelText("Postings scored per run"), "30");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ maxScores: 30 });
    await user.selectOptions(screen.getByLabelText("Pages per search and source"), "3");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ maxPages: 3 });
    expect(screen.getByLabelText("JSearch requests per 24 hours")).toHaveAccessibleDescription("A run sends it up to 3 requests.");
    await user.selectOptions(screen.getByLabelText("JSearch requests per 24 hours"), "No limit");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ budgets: { JSEARCH: null, ADZUNA: 3, FREEHIRE: null } });
  });

  it("takes startups from Startups when asked, at a match chosen", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.queryByLabelText("Startups' match, at least")).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Include Startups" }));
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ startups: true });
    await user.selectOptions(screen.getByLabelText("Startups' match, at least"), "70 of 100");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ startupMinMatch: 70 });
  });

  it("prepares no drafts on its own unless asked, and then up to the cap", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByLabelText("Drafts per run, at most")).toBeDisabled();
    const toggle = screen.getByRole("switch", { name: "Prepare drafts on its own" });
    await user.click(toggle);
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ autoDraft: true });
    await user.selectOptions(screen.getByLabelText("Drafts per run, at most"), "5");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ maxDrafts: 5 });
    expect(toggle).toHaveAccessibleDescription(/up to 5 drafts/);
  });

  it("explains the limits in plain words", () => {
    open();
    expect(screen.getByText(/^One run a day, and Run now whenever a source has requests left\. Each run scores up to 15 postings\./)).toBeInTheDocument();
  });

  it("points to the sources or AI provider while one isn't set up", () => {
    const { unmount } = open({ sources: [] });
    expect(screen.getByRole("note")).toHaveTextContent(
      "The agent searches the sources you choose in Settings → Job search, other than the Bundesagentur für Arbeit. Choose JSearch, Adzuna or FreeHire first.",
    );
    unmount();
    open({ scoring: { scorer: "AI", ready: false } });
    expect(within(screen.getByRole("note")).getByRole("link", { name: "Settings → AI provider" })).toHaveAttribute("href", "/settings?section=ai");
  });

  it("asks for the TypeSafe key when Jev scores without one (#274)", () => {
    open({ scoring: { scorer: "JEV", ready: false } });
    expect(screen.getByRole("note")).toHaveTextContent("The agent scores postings with Jev, which needs your TypeSafe key in Settings → Scoring.");
  });

  it("switches back and says why when a change isn't saved", async () => {
    const user = userEvent.setup();
    vi.mocked(saveAgentSettings).mockResolvedValueOnce({ ok: false, error: "Add a search with what to look for and a country before turning the agent on." });
    open();
    await user.click(screen.getByRole("switch", { name: "Run the job agent" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Run the job agent" })).toHaveAttribute("aria-checked", "false"));
    expect(toast).toHaveBeenCalledWith("Add a search with what to look for and a country before turning the agent on.");
  });
});
