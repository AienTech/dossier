import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobSearchSettingsView } from "@/lib/job-search/sources";

import { saveJobSearchDetails, saveJobSource, saveJobSourceKey, testJobSource } from "./actions";
import { JobSearchSection } from "./job-search-section";

vi.mock("./actions", () => ({
  saveJobSource: vi.fn(),
  saveJobSearchDetails: vi.fn(),
  saveJobSourceKey: vi.fn(),
  testJobSource: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const none = { openwebninja: "none", rapidapi: "none" } as const;
const off: JobSearchSettingsView = {
  sources: [],
  jsearch: { host: "openwebninja", keyState: "none", keyStates: none },
  adzuna: { appId: "", keyState: "none" },
  arbeitsagentur: { offered: true, acceptedAt: null },
  freehire: { host: "freehire.me" },
};
const ACCEPTED = "2026-10-23T09:00:00.000Z";
const withView = (view: Partial<JobSearchSettingsView>): JobSearchSettingsView => ({ ...off, ...view });
const switchFor = (name: string) => screen.getByRole("switch", { name });

beforeEach(() => {
  vi.mocked(saveJobSource)
    .mockReset()
    .mockImplementation(async ({ source, on }) => ({ ok: true, data: withView({ sources: on ? [source] : [] }) }));
  vi.mocked(saveJobSearchDetails).mockReset().mockImplementation(async ({ jsearchHost = "openwebninja", adzunaAppId = "" }) => ({
    ok: true,
    data: withView({ sources: ["JSEARCH"], jsearch: { host: jsearchHost, keyState: "none", keyStates: none }, adzuna: { appId: adzunaAppId, keyState: "none" } }),
  }));
  vi.mocked(saveJobSourceKey)
    .mockReset()
    .mockResolvedValue({ ok: true, data: withView({ sources: ["JSEARCH"], jsearch: { host: "openwebninja", keyState: "set", keyStates: { ...none, openwebninja: "set" } } }) });
  vi.mocked(testJobSource).mockReset().mockResolvedValue({ ok: true, data: { connected: true, seconds: 0.8 } });
});

describe("JobSearchSection", () => {
  it("offers the four sources as switches, all off by default", () => {
    render(<JobSearchSection initial={off} />);
    expect(screen.getByRole("heading", { name: "Job search" })).toBeInTheDocument();
    expect(screen.getAllByRole("switch").map((entry) => entry.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "false"]);
    expect(switchFor("JSearch")).toBeInTheDocument();
    expect(switchFor("Bundesagentur für Arbeit")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Test/ })).not.toBeInTheDocument();
  });

  it("turns a source on at once and says what's sent to the ones on", async () => {
    const { rerender } = render(<JobSearchSection initial={off} />);
    await userEvent.click(switchFor("JSearch"));
    expect(saveJobSource).toHaveBeenCalledWith({ source: "JSEARCH", on: true });
    expect(screen.getByRole("note")).toHaveTextContent("Your searches (keywords, place and filters) go to JSearch. Nothing from your profile does.");
    expect(screen.getByRole("link", { name: "OpenWeb Ninja" })).toHaveAttribute("href", "https://www.openwebninja.com/api/jsearch");
    rerender(<JobSearchSection key="both" initial={withView({ sources: ["JSEARCH", "FREEHIRE"] })} />);
    expect(screen.getByRole("note")).toHaveTextContent("go to JSearch, FreeHire.");
  });

  it("keeps a JSearch key for each host, saved when you leave the field", async () => {
    render(<JobSearchSection initial={withView({ sources: ["JSEARCH"] })} />);
    await userEvent.type(screen.getByLabelText("RapidAPI key"), "rk_secret");
    await userEvent.tab();
    expect(saveJobSourceKey).toHaveBeenCalledWith({ source: "JSEARCH", host: "rapidapi", change: { action: "set", value: "rk_secret" } });
    await userEvent.type(screen.getByLabelText("OpenWeb Ninja key"), "ak_secret{Enter}");
    expect(saveJobSourceKey).toHaveBeenLastCalledWith({ source: "JSEARCH", host: "openwebninja", change: { action: "set", value: "ak_secret" } });
    await waitFor(() => expect(screen.getByLabelText("OpenWeb Ninja key")).toHaveAttribute("placeholder", "Saved · type a new key to replace it"));
    await userEvent.click(screen.getByRole("button", { name: "Remove saved key" }));
    expect(saveJobSourceKey).toHaveBeenLastCalledWith({ source: "JSEARCH", host: "openwebninja", change: { action: "clear" } });
  });

  it("chooses which JSearch host is asked first", async () => {
    render(<JobSearchSection initial={withView({ sources: ["JSEARCH"] })} />);
    await userEvent.click(screen.getByRole("radio", { name: "RapidAPI" }));
    expect(saveJobSearchDetails).toHaveBeenCalledWith({ jsearchHost: "rapidapi" });
  });

  it("asks Adzuna for an app ID and key, saving the ID when you leave it", async () => {
    vi.mocked(saveJobSearchDetails).mockResolvedValue({ ok: true, data: withView({ sources: ["ADZUNA"], adzuna: { appId: "app-1", keyState: "none" } }) });
    render(<JobSearchSection initial={withView({ sources: ["ADZUNA"] })} />);
    await userEvent.type(screen.getByLabelText("App ID"), "app-1");
    await userEvent.tab();
    expect(saveJobSearchDetails).toHaveBeenCalledWith({ adzunaAppId: "app-1" });
    expect(screen.getByLabelText("App key")).toHaveAttribute("type", "password");
  });

  it("turns the Arbeitsagentur on only once its note is ticked (#223)", async () => {
    vi.mocked(saveJobSource).mockResolvedValue({ ok: true, data: withView({ sources: ["ARBEITSAGENTUR"], arbeitsagentur: { offered: true, acceptedAt: ACCEPTED } }) });
    render(<JobSearchSection initial={off} />);
    await userEvent.click(switchFor("Bundesagentur für Arbeit"));
    expect(saveJobSource).not.toHaveBeenCalled();
    expect(screen.getByText(/has no official API\. Dossier searches it through the access its own job search uses, without its permission/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "I understand, and choose this source myself" }));
    expect(saveJobSource).toHaveBeenCalledWith({ source: "ARBEITSAGENTUR", on: true, accepted: true });
    expect(await screen.findByRole("button", { name: "Test connection" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/The job agent doesn't search this source/)).toBeInTheDocument();
  });

  it("leaves the Arbeitsagentur out when the server doesn't offer it", () => {
    render(<JobSearchSection initial={withView({ arbeitsagentur: { offered: false, acceptedAt: null } })} />);
    expect(screen.queryByRole("switch", { name: "Bundesagentur für Arbeit" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(3);
  });

  it("says which FreeHire it searches, with no key to ask for", () => {
    const { unmount } = render(<JobSearchSection initial={withView({ sources: ["FREEHIRE"] })} />);
    expect(screen.getByText("No key needed. Dossier searches FreeHire's public catalogue at freehire.me.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/key/i)).not.toBeInTheDocument();
    unmount();
    render(<JobSearchSection initial={withView({ sources: ["FREEHIRE"], freehire: { host: "jobs.example" } })} />);
    expect(screen.getByText("No key needed. Dossier searches your own FreeHire at jobs.example.")).toBeInTheDocument();
  });

  it("shows keys from the environment and keys that can't be read", () => {
    const { unmount } = render(<JobSearchSection initial={withView({ sources: ["JSEARCH"], jsearch: { host: "openwebninja", keyState: "env", keyStates: { ...none, openwebninja: "env" } } })} />);
    expect(screen.getByLabelText("OpenWeb Ninja key")).toHaveAttribute("placeholder", "Using DOSSIER_JSEARCH_KEY · type one to save it here");
    unmount();
    render(<JobSearchSection initial={withView({ sources: ["JSEARCH"], jsearch: { host: "openwebninja", keyState: "unreadable", keyStates: { ...none, openwebninja: "unreadable" } } })} />);
    expect(screen.getByText("Your saved key can't be read. Please enter it again.")).toBeInTheDocument();
  });

  it("tests each source, and each JSearch key, and says how it went", async () => {
    render(<JobSearchSection initial={withView({ sources: ["JSEARCH", "FREEHIRE"], jsearch: { host: "openwebninja", keyState: "set", keyStates: { openwebninja: "set", rapidapi: "set" } } })} />);
    await userEvent.click(screen.getByRole("button", { name: "Test RapidAPI" }));
    expect(testJobSource).toHaveBeenCalledWith({ source: "JSEARCH", host: "rapidapi" });
    expect(await screen.findByText("Connected · JSearch answered in 0.8 s")).toBeInTheDocument();

    vi.mocked(testJobSource).mockResolvedValue({ ok: true, data: { connected: false, message: "FreeHire isn't answering right now." } });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(testJobSource).toHaveBeenLastCalledWith({ source: "FREEHIRE", host: undefined });
    expect(await screen.findByText("FreeHire isn't answering right now.")).toBeInTheDocument();
  });
});
