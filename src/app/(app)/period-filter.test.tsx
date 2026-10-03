import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rememberDashboardPeriod } from "./actions";
import { PeriodFilter } from "./period-filter";

const router = { replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => ({ rememberDashboardPeriod: vi.fn(async () => ({ ok: true, data: null })) }));

describe("the dashboard's period filter (E9-8)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the period in use, above what it scopes", () => {
    render(
      <PeriodFilter period="90d">
        <p>The figures</p>
      </PeriodFilter>,
    );
    const filter = screen.getByRole("radiogroup", { name: "Showing" });
    expect(screen.getByRole("radio", { name: "Last 90 days" })).toBeChecked();
    expect(filter.compareDocumentPosition(screen.getByText("The figures")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("switches the figures and remembers the choice for next time", async () => {
    const user = userEvent.setup();
    render(
      <PeriodFilter period="all">
        <p>The figures</p>
      </PeriodFilter>,
    );
    await user.click(screen.getByRole("radio", { name: "Last 30 days" }));
    expect(rememberDashboardPeriod).toHaveBeenCalledWith({ period: "30d" });
    expect(router.replace).toHaveBeenCalledWith("/?period=30d", { scroll: false });
  });
});
