import { beforeEach, describe, expect, it, vi } from "vitest";

import { workingHours } from "@/lib/google/availability";
import { loadCalendar } from "@/lib/google/calendar-data";

import { DashboardCalendar } from "./dashboard-calendar";

vi.mock("@/lib/google/availability", () => ({ workingHours: vi.fn() }));
vi.mock("@/lib/google/calendar-data", () => ({ loadCalendar: vi.fn() }));

const now = new Date("2026-10-18T23:30:00Z");
const timeZone = "Europe/Berlin";

describe("the dashboard calendar query date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workingHours).mockResolvedValue({ days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timeZone, slotMinutes: 45, bufferMinutes: 15 });
    vi.mocked(loadCalendar).mockResolvedValue({ items: [], timeZone, source: { status: "not-connected" } });
  });

  it.each(["2026-02-29", "2026-02-30", "2026-04-31"])("uses the configured-time-zone today for impossible date %s", async (date) => {
    const calendar = await DashboardCalendar({ date, now });

    expect(calendar).toMatchObject({ props: { month: "2026-10-19", today: "2026-10-19", start: "2026-10-19" } });
    expect(loadCalendar).toHaveBeenCalledTimes(1);
    expect(loadCalendar).toHaveBeenCalledWith(["2026-09-28", "2026-11-07"]);
  });

  it("keeps a valid explicit day and its month navigation", async () => {
    const calendar = await DashboardCalendar({ date: "2024-02-29", now });

    expect(calendar).toMatchObject({
      props: {
        month: "2024-02-29",
        today: "2026-10-19",
        start: "2024-02-29",
        links: { previous: "/?date=2024-01-01", next: "/?date=2024-03-01", today: "/" },
      },
    });
  });
});
