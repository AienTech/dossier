import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { unzipSync, strFromU8 } from "fflate";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  root: "" as string,
  template: "Apply for {{role}} at {{company}}",
  application: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/env", () => ({ env: { HIREME_PUBLIC_URL: "https://hireme.example" } }));
vi.mock("@/lib/settings-data", async () => {
  const { settingsFromRows } = await import("@/lib/settings");
  return { loadSettings: async () => settingsFromRows([{ key: "applyBotPromptTemplate", value: data.template }, { key: "applyBotOpenbotNotes", value: "OpenBot uses a review table" }]) };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    application: {
      findUnique: vi.fn(async () => data.application),
    },
  },
}));

vi.mock("@/lib/pdf/render", () => ({
  renderPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));
vi.mock("@/lib/stored-files", () => ({ storeFile: vi.fn(async () => {}) }));

vi.mock("@/lib/profile-data", () => ({
  loadProfile: async () => ({
    basics: {
      name: "Jane Doe",
      headline: "Android / Flutter engineer",
      email: "",
      phone: "",
      dob: "",
      website: "",
      address: "",
      city: "Lisbon",
      country: "Portugal",
      linkedin: "",
      summary: "8+ years Android/mobile, 5+ Flutter.",
      showAge: false,
    },
  }),
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => data.root };
});

import { renderPdf } from "@/lib/pdf/render";
import { storeFile } from "@/lib/stored-files";

import { applyPacketDir, buildApplyPacket, writeApplyPacket } from "./apply-packet";

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.mocked(storeFile).mockClear();
  data.root = await mkdtemp(path.join(tmpdir(), "hireme-apply-"));
  data.application = {
    id: "app1",
    createdAt: new Date("2026-11-14T01:00:00Z"),
    title: "Frontend",
    company: "Acme",
    status: "DRAFT",
    role: "Frontend",
    location: "Remote",
    salary: "",
    postingUrl: "https://jobs.example/1",
    postingText: "Build great UIs.",
    match: { items: [] },
    documents: [
      { kind: "RESUME", units: [{ id: "summary", label: "Summary", text: "I ship frontends." }] },
      { kind: "COVER_LETTER", units: [{ id: "body", label: "Body", text: "Dear hiring team." }] },
    ],
  };
});

afterEach(async () => {
  await rm(data.root, { recursive: true, force: true });
});

describe("writeApplyPacket", () => {
  it("packages cloud materials privately for download instead of writing a server-local folder", async () => {
    vi.stubEnv("HIREME_RUNTIME", "web");
    vi.mocked(renderPdf).mockClear();
    const result = await writeApplyPacket("app1");
    expect(result.downloadUrl).toBe("/api/apply-packets/app1");
    expect(result.archiveName).toBe("Acme-Frontend-2026-11-14.zip");
    expect(renderPdf).not.toHaveBeenCalled();
    expect(storeFile).not.toHaveBeenCalled();
    const { zip } = await buildApplyPacket("app1");
    const files = unzipSync(zip);
    expect(files["Acme-Frontend-2026-11-14/resume.pdf"]).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(strFromU8(files["Acme-Frontend-2026-11-14/instructions.md"])).toContain("~/Documents/hireme/apply/Acme-Frontend-2026-11-14");
    expect(strFromU8(files["Acme-Frontend-2026-11-14/instructions.md"])).toContain("never submit without my OK");
    expect(strFromU8(files["Acme-Frontend-2026-11-14/application.md"])).toContain("Lisbon, Portugal");
    expect(strFromU8(files["Acme-Frontend-2026-11-14/bot-prompt.md"])).toContain("Apply for Frontend at Acme");
    expect(strFromU8(files["Acme-Frontend-2026-11-14/bot-prompt.md"])).toContain("https://hireme.example/api/apply-packets/app1");
    expect(strFromU8(files["Acme-Frontend-2026-11-14/bot-prompt.md"])).toContain("### OpenBot");
    expect(storeFile).not.toHaveBeenCalled();
    await expect(readFile(path.join(applyPacketDir("Acme-Frontend-2026-11-14"), "resume.pdf"))).rejects.toThrow();
  });
  it("writes markdown and PDFs under Documents/HireMe/apply/{company}-{role}-{date}", async () => {
    const result = await writeApplyPacket("app1");
    expect(result.dir).toBe(applyPacketDir("Acme-Frontend-2026-11-14"));
    expect(result.files).toEqual(["application.md", "instructions.md", "bot-prompt.md", "resume.pdf", "cover-letter.pdf"]);
    expect(renderPdf).toHaveBeenCalledWith("/print/resume/app1");
    expect(renderPdf).toHaveBeenCalledWith("/print/letter/app1");

    const applicationMd = await readFile(path.join(result.dir, "application.md"), "utf8");
    expect(applicationMd).toContain("Acme");
    expect(applicationMd).toContain("https://jobs.example/1");
    expect(applicationMd).toContain("I ship frontends.");
    expect(applicationMd).toContain("Dear hiring team.");

    const instructions = await readFile(path.join(result.dir, "instructions.md"), "utf8");
    expect(instructions).toContain(result.dir);
    expect(instructions).toContain("mark it Sent in HireMe");
    expect(instructions).toContain("Lisbon, Portugal");
    expect(instructions).toContain("My standard answers");
    expect(result.answers).toMatchObject({ location: "Lisbon, Portugal" });

    expect(applicationMd).toContain("Standard answers for the form");
    expect(applicationMd).toContain("Candidate contact and profile");
    expect(applicationMd).toContain("Full name: Jane Doe");
    expect(applicationMd).toContain("Professional headline: Android / Flutter engineer");
    expect(await readFile(path.join(result.dir, "resume.pdf"))).toEqual(Buffer.from([37, 80, 68, 70]));
  });

  it("rewrites its own local packet but never overwrites another application's same-name folder", async () => {
    const first = await writeApplyPacket("app1");
    await expect(writeApplyPacket("app1")).resolves.toMatchObject({ dir: first.dir });
    data.application!.id = "app2";
    await expect(writeApplyPacket("app2")).rejects.toThrow("Another application");
    expect(await readFile(path.join(first.dir, "application.md"), "utf8")).toContain("Application id: `app1`");
  });

  it("rejects a missing application", async () => {
    data.application = null;
    await expect(writeApplyPacket("gone")).rejects.toThrow(/no longer exists/);
  });
});
