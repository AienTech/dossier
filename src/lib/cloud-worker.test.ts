import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), on: vi.fn(), heartbeat: vi.fn(), options: undefined as undefined | { connectionString: string } }));
vi.mock("pg", () => ({
  Client: class {
    constructor(options: { connectionString: string }) { fake.options = options; }
    query = fake.query;
    connect = fake.connect;
    on = fake.on;
  },
}));
vi.mock("@/lib/jobs/runner", () => ({ pollDatabaseQueue: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { setting: { upsert: fake.heartbeat }, job: { count: async () => 0 } } }));
vi.mock("@/lib/google/sync", () => ({ inboxCheckRunning: () => false }));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => {}) }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  fake.query.mockResolvedValue({ rows: [{ acquired: true }] });
  fake.heartbeat.mockResolvedValue({});
});

describe("cloud worker leadership", () => {
  it("refuses to run without a direct database connection", async () => {
    const { acquireWorkerLeadership } = await import("./cloud-worker");
    await expect(acquireWorkerLeadership()).rejects.toThrow(/DATABASE_URL_UNPOOLED/);
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it("refuses Neon's transaction pooler for a session-scoped lock", async () => {
    vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://user:password@ep-example-pooler.eu.neon.tech/db");
    const { acquireWorkerLeadership } = await import("./cloud-worker");
    await expect(acquireWorkerLeadership()).rejects.toThrow(/not a pooled/);
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it("waits for the old worker's lock before acquiring leadership", async () => {
    const url = "postgresql://user:password@ep-example.eu.neon.tech/db";
    vi.stubEnv("DATABASE_URL_UNPOOLED", url);
    fake.query.mockResolvedValueOnce({ rows: [{ acquired: false }] }).mockResolvedValueOnce({ rows: [{ acquired: true }] });
    const { acquireWorkerLeadership } = await import("./cloud-worker");
    await acquireWorkerLeadership();
    expect(fake.options?.connectionString).toBe(url);
    expect(fake.query).toHaveBeenCalledTimes(2);
    expect(fake.query).toHaveBeenCalledWith("SELECT pg_try_advisory_lock($1) AS acquired", [expect.any(Number)]);
    await acquireWorkerLeadership();
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });

  it("does not start consuming jobs before leadership", async () => {
    const { startCloudQueue } = await import("./cloud-worker");
    expect(() => startCloudQueue()).toThrow(/leadership/);
  });
});


describe("worker heartbeat resilience", () => {
  it("continues processing jobs when a monitoring write fails", async () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("Unexpected worker exit"); });
    try {
      vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://test:test@localhost/test");
      fake.heartbeat.mockRejectedValueOnce(new Error("monitoring write failed"));
      const { acquireWorkerLeadership, startCloudQueue } = await import("./cloud-worker");
      const { pollDatabaseQueue } = await import("@/lib/jobs/runner");
      await acquireWorkerLeadership(); startCloudQueue();
      await vi.waitFor(() => expect(pollDatabaseQueue).toHaveBeenCalled());
      expect(exit).not.toHaveBeenCalled();
    } finally { vi.clearAllTimers(); vi.useRealTimers(); exit.mockRestore(); }
  });
});
