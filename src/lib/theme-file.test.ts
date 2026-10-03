import { describe, expect, it } from "vitest";

import { parseThemeFile, themeFile, themeFileName } from "./theme-file";
import { BUILT_IN_THEMES } from "./themes";

const editorial = BUILT_IN_THEMES[0];

describe("theme files (E5-7)", () => {
  it("exports the look without ids, and reads it back", () => {
    const file = themeFile({ ...editorial, name: "Quiet green", accent: "#1F6F5C" });
    expect(file).toEqual({
      format: "dossier-theme",
      version: 2,
      theme: expect.not.objectContaining({ id: expect.anything() }),
    });
    const read = parseThemeFile(JSON.parse(JSON.stringify(file)));
    expect(read).toEqual({ ok: true, theme: { ...file.theme, accent: "#1f6f5c" } });
  });

  it("keeps the header, sidebar and date styles", () => {
    const atlas = BUILT_IN_THEMES.find((theme) => theme.id === "atlas")!;
    expect(parseThemeFile(themeFile({ ...atlas, sidebarStyle: "TINTED" }))).toMatchObject({
      ok: true,
      theme: { headFont: "LIBRE_CASLON", headerStyle: "BANNER", sidebarStyle: "TINTED", dateStyle: "TIMELINE" },
    });
  });

  it("reads version 1 files, which have no header, sidebar or date style, with the defaults", () => {
    const { name, headFont, bodyFont, accent, layout, align, headingStyle, density } = editorial;
    const look = { name, headFont, bodyFont, accent, layout, align, headingStyle, density };
    expect(parseThemeFile({ format: "dossier-theme", version: 1, theme: look })).toEqual({
      ok: true,
      theme: { ...look, headerStyle: "PLAIN", sidebarStyle: "PLAIN", dateStyle: "INLINE" },
    });
  });

  it("refuses other files, newer versions, unknown fonts and bad colors, in plain words", () => {
    const file = themeFile(editorial);
    expect(parseThemeFile({ hello: "world" })).toEqual({ ok: false, error: "That file isn't a Dossier theme." });
    expect(parseThemeFile(null)).toEqual({ ok: false, error: "That file isn't a Dossier theme." });
    expect(parseThemeFile({ ...file, version: 3 })).toEqual({ ok: false, error: "That theme comes from a newer version of Dossier. Update this server first." });
    expect(parseThemeFile({ ...file, theme: { ...file.theme, headFont: "COMIC_SANS" } })).toEqual({
      ok: false,
      error: "That theme uses a font Dossier doesn't have (COMIC_SANS).",
    });
    expect(parseThemeFile({ ...file, theme: { ...file.theme, accent: "green" } })).toEqual({ ok: false, error: "That theme file is damaged (theme.accent)." });
  });

  it("names the file after the theme, safely", () => {
    expect(themeFileName({ name: "Quiet green" })).toBe("Quiet green.dossier-theme.json");
    expect(themeFileName({ name: 'A/B: "best"' })).toBe("A B best.dossier-theme.json");
    expect(themeFileName({ name: "   " })).toBe("Theme.dossier-theme.json");
  });
});
