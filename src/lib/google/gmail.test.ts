import { describe, expect, it, vi } from "vitest";

vi.mock("./account", () => ({ googleFetch: vi.fn() }));

import { readMessage } from "./gmail";

const message = (overrides: { internalDate?: string; date?: string } = {}) => ({
  id: "message-id",
  threadId: "thread-id",
  ...(overrides.internalDate === undefined ? {} : { internalDate: overrides.internalDate }),
  payload: {
    mimeType: "text/plain",
    headers: overrides.date === undefined ? [] : [{ name: "Date", value: overrides.date }],
    body: { data: Buffer.from("Message body").toString("base64url") },
  },
});

describe("readMessage", () => {
  it("uses the current time when internalDate and the Date header are missing", () => {
    const before = Date.now();
    const result = readMessage(message());
    const after = Date.now();

    expect(result.date.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.date.getTime()).toBeLessThanOrEqual(after);
  });

  it("uses the Date header when internalDate is malformed", () => {
    const result = readMessage({ ...message({ internalDate: " 1793253600000 ", date: "Thu, 29 Oct 2026 06:00:00 GMT" }) });

    expect(result.date.toISOString()).toBe("2026-10-29T06:00:00.000Z");
  });

  it("uses the internal millisecond timestamp when it is valid", () => {
    const result = readMessage(message({ internalDate: "1793253600000", date: "Thu, 29 Oct 2026 06:00:00 GMT" }));

    expect(result.date.toISOString()).toBe("2026-10-29T06:00:00.000Z");
  });
});
