import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../prisma/seed/built-ins";
import { seedDemo } from "../../prisma/seed/demo";

import { loadDashboard } from "./dashboard-data";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

const prisma = () => db.client!;
const now = new Date(2026, 8, 27, 12);

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  await seedDemo(prisma(), { now });
});
afterAll(() => prisma().$disconnect());

describe("loadDashboard against the demo seed (E9-6)", () => {
  it("has 7 sent, 5 heard back (71%) and 3 that reached an interview", async () => {
    const figures = await loadDashboard({}, now);
    expect(figures).toMatchObject({ sent: 7, heardBack: 5, heardBackPercent: 71, reachedInterview: 3 });
    expect(figures.funnel.map((step) => step.count)).toEqual([7, 5, 3, 2, 0]);
    expect(figures.byStatus).toEqual({ DRAFT: 2, SENT: 2, SCREENING: 1, INTERVIEW: 1, OFFER: 1, ACCEPTED: 0, REJECTED: 1, DECLINED: 1 });
  });

  it("lists tomorrow's interview, the offer, the drafts and the quiet one", async () => {
    const figures = await loadDashboard({ timeZone: "Europe/Amsterdam" }, now);
    expect(figures.attention.map((item) => `${item.company}: ${item.reason}`)).toEqual([
      "Northstar Health: Interview tomorrow at 14:00. Worth re-reading your tailored letter first.",
      "Oaken Studio: An offer is waiting on your decision.",
      "Brightline Transit: Still a draft, and applications close 3 Oct.",
      "Ledgerly: Still a draft, and applications close 15 Oct.",
      "Kestrel Maps: No news for 7 days. A short, friendly follow-up could help.",
    ]);
    expect(figures.attention[0].soon).toBe(true);
  });

  it("nudges sooner or later as set (E9-9)", async () => {
    const quiet = async (quietDays: number) =>
      (await loadDashboard({ quietDays }, now)).attention.filter((item) => item.reason.startsWith("No news")).map((item) => item.company);
    expect(await quiet(3)).toEqual(["Kestrel Maps", "Tidewater Energy", "Meridian Bank"]);
    expect(await quiet(14)).toEqual([]);
  });

  it("still counts archived applications in the funnel", async () => {
    await prisma().application.updateMany({ where: { company: "Quill & Co" }, data: { archivedAt: now } });
    const figures = await loadDashboard({}, now);
    expect(figures).toMatchObject({ sent: 7, heardBack: 5, reachedInterview: 3 });
    expect(figures.byStatus.DECLINED).toBe(1);
  });
});
