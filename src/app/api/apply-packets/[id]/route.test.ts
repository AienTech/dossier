import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ HIREME_APPLY_PACKET_PASSWORD: undefined as string | undefined }));

vi.mock("@/lib/env", () => ({ env: config }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { application: { findUnique: vi.fn() } } }));
vi.mock("@/lib/apply-packet", () => ({ buildApplyPacket: vi.fn() }));
// The packet's links use the deployment's public origin; the request host is not enough here.
vi.mock("@/lib/google/origin", () => ({ publicOrigin: () => "https://hireme.example" }));

import { getSession } from "@/lib/auth/session";
import { buildApplyPacket } from "@/lib/apply-packet";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

const get = (url = "http://localhost:3000/api/apply-packets/app1", headers: HeadersInit = { host: "localhost:3000" }) =>
  GET(new NextRequest(url, { headers }), { params: Promise.resolve({ id: "app1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  config.HIREME_APPLY_PACKET_PASSWORD = undefined;
  vi.mocked(getSession).mockResolvedValue({ persistent: false, issuedAt: new Date(), expiresAt: new Date() });
  vi.mocked(prisma.application.findUnique).mockResolvedValue({ id: "app1" } as never);
  vi.mocked(buildApplyPacket).mockResolvedValue({
    packet: { dir: "Example-Engineer-2026-11-14", archiveName: "Example-Engineer-2026-11-14.zip", files: [], answers: { location: "", expectedSalary: "", experience: "" } },
    zip: new Uint8Array([80, 75, 3, 4]),
  });
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

  it("does not render private files without a session or password", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(buildApplyPacket).not.toHaveBeenCalled();
  });

  it("serves the ZIP with the shared password without a session, including cross-origin GETs", async () => {
    config.HIREME_APPLY_PACKET_PASSWORD = "packet-secret";
    vi.mocked(getSession).mockResolvedValue(null);
    const response = await get("http://localhost:3000/api/apply-packets/app1?password=packet-secret", {
      host: "localhost:3000",
      "sec-fetch-site": "cross-site",
      origin: "https://grok.example",
    });
    expect(response.status).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
    expect(buildApplyPacket).toHaveBeenCalled();
  });

  it("rejects a wrong password without falling back to a missing session", async () => {
    config.HIREME_APPLY_PACKET_PASSWORD = "packet-secret";
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await get("http://localhost:3000/api/apply-packets/app1?password=wrong")).status).toBe(401);
    expect(buildApplyPacket).not.toHaveBeenCalled();
  });

  it("does not render a deleted or unreviewed application", async () => {
    vi.mocked(prisma.application.findUnique).mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(buildApplyPacket).not.toHaveBeenCalled();
  });
});
