import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: async (work: (tx: unknown) => unknown) => work({ $queryRaw: vi.fn(), job: { count: async () => 0 } }) } }));
import { GET } from "./route";
const request = (auth = "Bearer cron-test") => new Request("https://hireme.example/api/worker-schedule", { headers: { authorization: auth } });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-test");
  vi.stubEnv("HIREME_WORKER_VERCEL_TOKEN", "vercel-test");
  vi.stubEnv("HIREME_WORKER_PROJECT_ID", "prj_example");
  vi.stubEnv("HIREME_WORKER_TEAM_ID", "team_example");
  vi.stubEnv("VERCEL_ENV", "production");
  fetchMock = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("private worker schedule", () => {
  it("refuses missing or incorrect scheduler credentials before any API call", async () => {
    for (const auth of ["", "Bearer wrong", "Basic cron-test"]) expect((await GET(request(auth))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not scale previews or unconfigured production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await GET(request())).status).toBe(503);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("HIREME_WORKER_VERCEL_TOKEN", "");
    expect((await GET(request())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([["2026-11-13T15:59:59Z", 0], ["2026-11-13T16:00:00Z", 1], ["2026-11-13T21:59:59Z", 1], ["2026-11-13T22:00:00Z", 0]])("uses current time %s, including delayed start invocations", async (time, count) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(time));
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ ok: true, instances: count });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/hireme-worker/instances?teamId=team_example"), expect.objectContaining({ method: "PUT", body: JSON.stringify({ fra1: count }), redirect: "error" }));
  });
  it("reports API rejection instead of claiming the worker stopped", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "private provider detail" }, { status: 403 }));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private provider detail");
  });
});
