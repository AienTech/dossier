"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Country } from "@/lib/job-search/countries";
import { POSTED_WITHIN, RADII_KM, type JobSource, type RadiusKm, type SearchQuery } from "@/lib/job-search/search";
import { SOURCE_INFO, sourceCovers } from "@/lib/job-search/sources";

// A search's fields, as Find jobs asks them (E14-6) and Settings → Job agent
// saves its search (E16-7).

export type SearchFieldErrors = { keywords?: string; country?: string };

/** Why none of `sources` can search the country, in words, or undefined; a source that can't is skipped when others can. */
export function uncoveredCountry(sources: readonly JobSource[], query: SearchQuery, countries: readonly Country[]): string | undefined {
  if (sources.length === 0 || !query.country || sources.some((source) => sourceCovers(source, query.country))) return undefined;
  const name = countries.find((country) => country.code === query.country)?.name ?? query.country.toUpperCase();
  return `${sources.map((source) => SOURCE_INFO[source].name).join(" and ")} ${sources.length === 1 ? "doesn't" : "don't"} list jobs in ${name}.`;
}

/** What, Where, Country, Within and Posted, for a grid; Remote only is RemoteOnlyField. */
export function SearchFields({
  value,
  onChange,
  sources,
  countries,
  errors = {},
  onBlur,
}: {
  value: SearchQuery;
  onChange: (patch: Partial<SearchQuery>) => void;
  sources: readonly JobSource[];
  countries: readonly Country[];
  errors?: SearchFieldErrors;
  /** For text fields that save once typing is done. */
  onBlur?: () => void;
}) {
  const uncovered = uncoveredCountry(sources, value, countries);
  const withoutRadius = sources.filter((source) => !SOURCE_INFO[source].radius);
  const noRadius = sources.length > 0 && withoutRadius.length === sources.length;
  return (
    <>
      <Input
        label="What"
        className="sm:col-span-2 lg:col-span-1"
        value={value.keywords}
        placeholder="Job title, skill or company"
        error={errors.keywords}
        onChange={(event) => onChange({ keywords: event.target.value })}
        onBlur={onBlur}
      />
      <Input label="Where" value={value.place} placeholder="City or region" onChange={(event) => onChange({ place: event.target.value })} onBlur={onBlur} />
      <Select label="Country" value={value.country} error={errors.country ?? uncovered} onChange={(event) => onChange({ country: event.target.value })}>
        <option value="">Choose a country</option>
        {countries.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name}
          </option>
        ))}
      </Select>
      <Select
        label="Within"
        value={String(value.radiusKm)}
        disabled={noRadius || !value.place.trim()}
        hint={
          withoutRadius.length > 0
            ? `${withoutRadius.map((source) => SOURCE_INFO[source].name).join(" and ")} ${withoutRadius.length === 1 ? "has" : "have"} no distance filter`
            : value.place.trim()
              ? undefined
              : "Add a place first"
        }
        onChange={(event) => onChange({ radiusKm: Number(event.target.value) as RadiusKm })}
      >
        {RADII_KM.map((km) => (
          <option key={km} value={km}>
            {km} km
          </option>
        ))}
      </Select>
      <Select label="Posted" value={value.postedWithin} onChange={(event) => onChange({ postedWithin: event.target.value as SearchQuery["postedWithin"] })}>
        {POSTED_WITHIN.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </>
  );
}

/** "Remote only", with what it means on Adzuna, which has no such filter. */
export function RemoteOnlyField({ value, onChange, sources }: { value: SearchQuery; onChange: (patch: Partial<SearchQuery>) => void; sources: readonly JobSource[] }) {
  return (
    <Checkbox
      label="Remote only"
      checked={value.remoteOnly}
      onChange={(event) => onChange({ remoteOnly: event.target.checked })}
      hint={sources.includes("ADZUNA") && value.remoteOnly ? "Adzuna has no remote filter, so this adds “remote” to your search." : undefined}
    />
  );
}
