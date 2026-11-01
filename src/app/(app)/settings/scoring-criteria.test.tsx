import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveScoringCriteria } from "./actions";
import { ScoringCriteria } from "./scoring-criteria";

vi.mock("./actions", () => ({ saveScoringCriteria: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

beforeEach(() => {
  vi.mocked(saveScoringCriteria).mockReset().mockImplementation(async ({ criteria }) => ({ ok: true, data: criteria }));
});

describe("ScoringCriteria", () => {
  it("adds criteria with how much each counts, and saves the filled ones", async () => {
    const user = userEvent.setup();
    render(<ScoringCriteria initial={[]} />);
    expect(screen.getByRole("button", { name: "Save criteria" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add a criterion" }));
    await user.type(screen.getByLabelText("Criterion 1"), "Salary");
    await user.type(screen.getByLabelText("What you want"), "At least 80k EUR");
    await user.selectOptions(screen.getByLabelText("Counts as"), "Must have");
    await user.click(screen.getByRole("button", { name: "Add a criterion" }));
    await user.click(screen.getByRole("button", { name: "Save criteria" }));
    expect(saveScoringCriteria).toHaveBeenCalledWith({
      criteria: [{ id: expect.any(String), label: "Salary", preference: "At least 80k EUR", importance: "MUST" }],
    });
    expect(screen.getAllByLabelText(/^Criterion/)).toHaveLength(1);
  });

  it("removes a criterion", async () => {
    const user = userEvent.setup();
    render(<ScoringCriteria initial={[{ id: "a", label: "Size", preference: "Small", importance: "NICE" }]} />);
    await user.click(screen.getByRole("button", { name: "Remove criterion 1" }));
    await user.click(screen.getByRole("button", { name: "Save criteria" }));
    expect(saveScoringCriteria).toHaveBeenCalledWith({ criteria: [] });
  });
});
