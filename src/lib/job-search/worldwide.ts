import type { JobSource } from "./search";
import { sourceCovers } from "./sources";

/**
 * Countries a "Worldwide" search fans out to. One request per country, so
 * change it with HIREME_WORLDWIDE_COUNTRIES (comma-separated ISO codes) to
 * trade reach for quota.
 */
export const DEFAULT_WORLDWIDE_COUNTRIES = ["us", "gb", "ca", "au", "de", "nl", "in", "sg", "ae", "jp"] as const;

/** ISO codes a worldwide search uses for `source` (only ones that source covers). */
export function worldwideCountries(source: JobSource): string[] {
  const configured = (process.env.HIREME_WORLDWIDE_COUNTRIES ?? DEFAULT_WORLDWIDE_COUNTRIES.join(","))
    .split(",")
    .map((country) => country.trim().toLowerCase())
    .filter((country) => /^[a-z]{2}$/.test(country));
  return [...new Set(configured)].filter((country) => sourceCovers(source, country));
}
