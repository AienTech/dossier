import { describe, expect, it } from "vitest";

import { contentDisposition, resolveFileName, type FileNameContext } from "./file-name";

const DEFAULT = "{name} – {company} – {doc}";
const ledgerly: FileNameContext = {
  name: "Lena Hartmann",
  company: "Ledgerly",
  role: "Senior Product Designer",
  doc: "RESUME",
  date: new Date(2026, 8, 27, 15, 30),
};

describe("resolveFileName", () => {
  it("fills in the default pattern", () => {
    expect(resolveFileName(DEFAULT, ledgerly)).toBe("Lena Hartmann – Ledgerly – Resume.pdf");
    expect(resolveFileName(DEFAULT, { ...ledgerly, doc: "COVER_LETTER" })).toBe(
      "Lena Hartmann – Ledgerly – Cover letter.pdf",
    );
  });

  it("knows every token", () => {
    expect(resolveFileName("{first} {role} {date}", ledgerly)).toBe("Lena Senior Product Designer 2026-09-27.pdf");
  });

  it("keeps unknown tokens as typed", () => {
    expect(resolveFileName("{name} {team}", ledgerly)).toBe("Lena Hartmann {team}.pdf");
  });

  it("collapses a missing value with its separator", () => {
    const base = { ...ledgerly, company: "", role: "" };
    expect(resolveFileName(DEFAULT, base)).toBe("Lena Hartmann – Resume.pdf");
    expect(resolveFileName("{company}_{name}_{doc}", base)).toBe("Lena Hartmann_Resume.pdf");
    expect(resolveFileName("{name}, {role}", base)).toBe("Lena Hartmann.pdf");
    expect(resolveFileName(DEFAULT, { ...base, name: "" })).toBe("Resume.pdf");
  });

  it("removes characters file systems don't allow", () => {
    expect(resolveFileName(DEFAULT, { ...ledgerly, company: 'AC/DC: "Live" <Tour>?*|\\' })).toBe(
      "Lena Hartmann – AC DC Live Tour – Resume.pdf",
    );
    expect(resolveFileName("{name}\u0000\n{doc}", ledgerly)).toBe("Lena Hartmann Resume.pdf");
  });

  it("collapses whitespace and trims dangling separators and dots", () => {
    expect(resolveFileName("  {name}   –  {doc} – ", ledgerly)).toBe("Lena Hartmann – Resume.pdf");
    expect(resolveFileName("...{name}...", ledgerly)).toBe("Lena Hartmann.pdf");
  });

  it("falls back to untitled", () => {
    expect(resolveFileName("", ledgerly)).toBe("untitled.pdf");
    expect(resolveFileName("{company}", { ...ledgerly, company: "" })).toBe("untitled.pdf");
    expect(resolveFileName(" / : ", ledgerly)).toBe("untitled.pdf");
  });

  it("limits the length without splitting characters", () => {
    const long = resolveFileName("{company}", { ...ledgerly, company: "Ledgerly ".repeat(30) });
    expect(long.length).toBeLessThanOrEqual(124);
    expect(long).toMatch(/^(Ledgerly )+Ledgerly\.pdf$/);
    const emoji = resolveFileName("{company}", { ...ledgerly, company: "😀".repeat(200) });
    expect(Array.from(emoji.replace(".pdf", ""))).toHaveLength(120);
  });

  it("keeps accents and non-Latin names", () => {
    expect(resolveFileName(DEFAULT, { ...ledgerly, name: "Zoë Müller" })).toBe("Zoë Müller – Ledgerly – Resume.pdf");
    expect(resolveFileName(DEFAULT, { ...ledgerly, name: "آیین", company: "" })).toBe("آیین – Resume.pdf");
  });

  it("avoids names Windows reserves", () => {
    expect(resolveFileName("{company}", { ...ledgerly, company: "CON" })).toBe("CON_.pdf");
  });
});

describe("contentDisposition", () => {
  it("sends an ASCII name and the full UTF-8 one", () => {
    expect(contentDisposition("Lena Hartmann – Ledgerly – Resume.pdf")).toBe(
      "attachment; filename=\"Lena Hartmann - Ledgerly - Resume.pdf\"; filename*=UTF-8''Lena%20Hartmann%20%E2%80%93%20Ledgerly%20%E2%80%93%20Resume.pdf",
    );
  });

  it("strips accents for the ASCII name and replaces what's left", () => {
    expect(contentDisposition("Zoë – آیین.pdf")).toMatch(/^attachment; filename="Zoe - ____.pdf"; filename\*=UTF-8''Zo%C3%AB/);
  });

  it("encodes the characters RFC 5987 reserves", () => {
    expect(contentDisposition("Lena's (draft)*.pdf")).toContain("filename*=UTF-8''Lena%27s%20%28draft%29%2A.pdf");
  });
});
