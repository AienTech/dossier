import type { FoundPosting, JobSource } from "@/lib/job-search/search";

/** How the agent discovered a posting — for Agent tabs / badges. */
export type DiscoverChannel = "careers" | "job_boards";

export const DISCOVER_CHANNEL_LABELS: Record<DiscoverChannel, string> = {
  careers: "Company careers (ATS)",
  job_boards: "Job boards",
};

const TAG_CAREERS = "HireMe:careers";
const TAG_BOARDS = "HireMe:boards";

/** FreeHire indexes company ATS pages; JSearch/Adzuna are job-board aggregators. */
export function channelForSource(source: JobSource): DiscoverChannel {
  return source === "FREEHIRE" ? "careers" : "job_boards";
}

/** Stamp a posting so the Agent screen can filter careers vs job boards later. */
export function tagDiscoverChannel(posting: FoundPosting, channel: DiscoverChannel, watchedCompany?: string): FoundPosting {
  const tag = channel === "careers" ? TAG_CAREERS : TAG_BOARDS;
  const watched = watchedCompany?.trim() ? `Watched:${watchedCompany.trim()}` : "";
  const parts = [posting.via.trim(), watched, tag].filter(Boolean);
  return { ...posting, via: parts.join(" · ") };
}

export function discoverChannelOf(via: string, source: JobSource): DiscoverChannel {
  if (via.includes(TAG_CAREERS)) return "careers";
  if (via.includes(TAG_BOARDS)) return "job_boards";
  return channelForSource(source);
}

/** Via line without internal HireMe tags (keep Watched / publisher names). */
export function displayVia(via: string): string {
  return via
    .replace(/\s*·\s*HireMe:(?:careers|boards)\b/g, "")
    .replace(/\s*HireMe:(?:careers|boards)\b/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}

export function watchedCompanyOf(via: string): string | null {
  const match = /Watched:([^·]+)/.exec(via);
  return match?.[1]?.trim() || null;
}
