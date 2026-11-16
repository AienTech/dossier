import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "@/lib/auth/session";
import { buildApplyPacket } from "@/lib/apply-packet";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { application: { findUnique: vi.fn() } } }));
vi.mock("@/lib/apply-packet", () => ({ buildApplyPacket: vi.fn() }));
// The packet's links use the deployment's public origin; the request host is not enough here.
vi.mock("@/lib/google/origin", () => ({ publicOrigin: () => "https://hireme.example" }));

const get = () => GET(new NextRequest("http://localhost:3000/api/apply-packets/app1", {
  headers: { host: "localhost:3000" },
}), { params: Promise.resolve({ id: "app1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue({ persistent: false, issuedAt: new Date(), expiresAt: new Date() });
  vi.mocked(prisma.application.findUnique).mockResolvedValue({ id: "app1" } as never);
  vi.mocked(buildApplyPacket).mockResolvedValue({ packet: { dir: "Example-Engineer-2026-11-14", archiveName: "Example-Engineer-2026-11-14.zip", files: [], answers: { location: "", expectedSalary: "", experience: "" } }, zip: new Uint8Array([80, 75, 3, 4]) });
});

describe("apply packet download", () => {
  it("generates a private named ZIP directly in the authenticated request", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain("Example-Engineer-2026-11-14.zip");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([80, 75, 3, 4]));
    expect(buildApplyPacket).toHaveBeenCalledWith("app1", "download", "https://hireme.example");
  });

  it("does not render private files without a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(buildApplyPacket).not.toHaveBeenCalled();
  });

  it("does not render a deleted or unreviewed application", async () => {
    vi.mocked(prisma.application.findUnique).mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(buildApplyPacket).not.toHaveBeenCalled();
  });
});
