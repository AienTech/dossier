import { createHash } from "node:crypto";

import type { PostingSource } from "@/generated/prisma/enums";

import { linkKey, type FoundPosting, type JobSource } from "./search";

// The same job found by several sources, or by the job agent on another
// day (E16): one key for all of them.

/** Lower case, letters and digits only, accents dropped: "Café  GmbH" and "cafe gmbh" are the same. */
const normal = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * The dedupe key: a hash of the link without tracking parameters, else of
 * company, title and place, so the same job found through another source or
 * in a later run matches. A posting with none of those falls back to its
 * source's id.
 */
export function agentDedupeKey(posting: Pick<FoundPosting, "externalId" | "url" | "title" | "company" | "place"> & { source: PostingSource }): string {
  const link = linkKey(posting.url);
  const facts = [posting.company, posting.title, posting.place].map(normal);
  const basis = link ? `link:${link}` : facts.some(Boolean) ? `job:${facts.join("|")}` : `id:${posting.source}:${posting.externalId}`;
  return createHash("sha256").update(basis).digest("hex");
}

/**
 * Postings from several sources as one list: one from each source in turn,
 * so no source crowds out the others, and each job once. A job found by
 * more than one source keeps the copy with the whole text, and names the
 * other sources in `alsoOn`.
 */
export function mergePostings(lists: readonly FoundPosting[][]): (FoundPosting & { alsoOn: JobSource[] })[] {
  const merged: (FoundPosting & { alsoOn: JobSource[] })[] = [];
  const byKey = new Map<string, number>();
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const posting = list[index];
      if (!posting) continue;
      const key = agentDedupeKey(posting);
      const at = byKey.get(key);
      if (at === undefined) {
        byKey.set(key, merged.length);
        merged.push({ ...posting, alsoOn: [] });
        continue;
      }
      const kept = merged[at];
      if (kept.source === posting.source) continue;
      const sources = [...new Set([kept.source, ...kept.alsoOn, posting.source])];
      const winner = !kept.complete && posting.complete ? posting : kept;
      merged[at] = { ...winner, alsoOn: sources.filter((source) => source !== winner.source) };
    }
  }
  return merged;
}
