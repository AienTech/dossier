import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SetupSection } from "./setup-section";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
it("shows missing configuration, optional integrations and direct fixes without claiming live API verification", () => {
  render(<SetupSection items={[
    { id: "profile", title: "Profile", status: "ready", detail: "Profile is complete", href: "/profile", required: true },
    { id: "jobs", title: "Job search", status: "attention", detail: "Missing API key", href: "/settings?section=jobs", required: true },
    { id: "mcp", title: "MCP", status: "optional", detail: "Optional integration", href: "/settings?section=connector", required: false },
  ]} />);
  expect(screen.getByText("1 of 2 required checks configured")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Configure Job search" })).toHaveAttribute("href", "/settings?section=jobs");
  expect(screen.getByText(/It does not prove that an API key/)).toBeInTheDocument();
  expect(screen.queryByText("Live check passed")).not.toBeInTheDocument();
});
