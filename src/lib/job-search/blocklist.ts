// Blocked companies (this fork, E14-8): postings Find jobs, the job agent
// and the Claude connector never show, score or let you draft for, by name
// — so a past or current employer, including a staffing role placed there,
// never comes back in a search. Settings → Job search keeps the list
// (settingsSchema.blockedCompanies in src/lib/settings.ts).
//
// A blocked name is matched against a posting's company, title AND
// description, not company alone: a staffing agency's own postings often
// name the client company only in the text ("role placed at Acme Corp"),
// and sources that don't give a separate company field at all (Firecrawl,
// see firecrawl.ts) only have the title and description to go on. This
// favours recall over precision on purpose — the point is never seeing the
// company again, not a perfectly worded match — so a blocked name can
// occasionally hide an unrelated posting that merely mentions it (e.g. "not
// an Acme Corp alumnus? no problem"). Keep blocked names specific for that
// reason: "Acme" blocks less precisely than "Acme Corporation".

/** Case- and punctuation-insensitive, so "ProArch IT Solutions Pvt. Ltd." and "proarch it solutions" compare equal. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A blocked name kept as given (for the list in Settings) and normalized once (for fast repeated matching). */
export type BlockedCompany = { name: string; normalized: string };

/** Settings' plain strings, normalized once, so searching many postings doesn't renormalize the list every time. */
export function compileBlocklist(names: readonly string[]): BlockedCompany[] {
  return names.map((name) => ({ name, normalized: normalize(name) })).filter((entry) => entry.normalized.length > 0);
}

/**
 * Whether `haystack` contains `needle` (already space-normalized, e.g. "best
 * buy") as a run of whole words: "best buy" matches "...engineer best buy
 * bengaluru...", but not "bestbuy" run together as one word. A short or
 * common needle ("it", "data") still matches wherever it stands alone as a
 * word, which is why the module note asks for specific blocked names.
 */
function containsWords(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(` ${haystack} `);
}

/**
 * Whether a posting is from, or mentions, a blocked company: checked against
 * its company, title and description (see the module note for why).
 */
export function isBlockedPosting(posting: { company: string; title: string; description?: string }, blocked: readonly BlockedCompany[]): boolean {
  if (blocked.length === 0) return false;
  const haystacks = [normalize(posting.company), normalize(posting.title), normalize(posting.description ?? "")];
  return blocked.some((entry) => haystacks.some((haystack) => containsWords(haystack, entry.normalized)));
}

/** The reason a posting was kept out, for a server log; never the posting's own text. */
export function blockedBy(posting: { company: string; title: string; description?: string }, blocked: readonly BlockedCompany[]): string | null {
  if (blocked.length === 0) return null;
  const haystacks = [normalize(posting.company), normalize(posting.title), normalize(posting.description ?? "")];
  const hit = blocked.find((entry) => haystacks.some((haystack) => containsWords(haystack, entry.normalized)));
  return hit?.name ?? null;
}
