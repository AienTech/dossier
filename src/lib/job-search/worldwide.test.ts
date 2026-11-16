import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_WORLDWIDE_COUNTRIES, worldwideCountries } from "./worldwide";

describe("worldwideCountries", () => {
  afterEach(() => {
    delete process.env.HIREME_WORLDWIDE_COUNTRIES;
  });

  it("defaults to the built-in list filtered by what the source covers", () => {
    expect(worldwideCountries("JSEARCH")).toEqual([...DEFAULT_WORLDWIDE_COUNTRIES]);
    expect(worldwideCountries("ARBEITSAGENTUR")).toEqual(["de"]);
  });

  it("honours HIREME_WORLDWIDE_COUNTRIES", () => {
    process.env.HIREME_WORLDWIDE_COUNTRIES = "de, nl, germany, DE";
    expect(worldwideCountries("JSEARCH")).toEqual(["de", "nl"]);
    expect(worldwideCountries("ARBEITSAGENTUR")).toEqual(["de"]);
  });
});
