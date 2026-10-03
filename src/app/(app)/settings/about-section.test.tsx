import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AboutSection } from "./about-section";
import { checkUpdates } from "./actions";

vi.mock("./actions", () => ({ checkUpdates: vi.fn() }));

const facts = [
  { label: "Version", value: "0.1.0" },
  { label: "Database", value: "PostgreSQL · 9.0 MB" },
];

describe("About (E10-9)", () => {
  it("lists the install's facts", () => {
    render(<AboutSection facts={facts} />);
    expect(screen.getByRole("heading", { name: "About this install" })).toBeInTheDocument();
    expect(screen.getByText("Free and open source. No accounts, no subscriptions.")).toBeInTheDocument();
    expect(screen.getAllByRole("definition").map((value) => value.textContent)).toEqual(["0.1.0", "PostgreSQL · 9.0 MB"]);
    expect(screen.getByText("PostgreSQL · 9.0 MB")).toHaveClass("font-mono");
    expect(checkUpdates).not.toHaveBeenCalled();
  });

  it("checks for updates only when asked", async () => {
    const user = userEvent.setup();
    vi.mocked(checkUpdates).mockResolvedValueOnce({ ok: true, data: { status: "latest" } });
    render(<AboutSection facts={facts} />);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(screen.getByRole("status")).toHaveTextContent("You're on the latest version.");
  });

  it("links a newer version", async () => {
    const user = userEvent.setup();
    vi.mocked(checkUpdates).mockResolvedValueOnce({ ok: true, data: { status: "newer", version: "0.2.0", url: "https://github.com/AienTech/dossier/releases/tag/v0.2.0" } });
    render(<AboutSection facts={facts} />);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(screen.getByRole("status")).toHaveTextContent("Version 0.2.0 is available.");
    expect(screen.getByRole("link", { name: "See what's new (opens in a new tab)" })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("says when it couldn't check", async () => {
    const user = userEvent.setup();
    vi.mocked(checkUpdates).mockResolvedValueOnce({ ok: true, data: { status: "unknown" } });
    render(<AboutSection facts={facts} />);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't check for updates right now.");
  });
});
