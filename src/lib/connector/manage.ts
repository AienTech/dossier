import "server-only";

import { createHash } from "node:crypto";

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import { ApplicationStatus } from "@/generated/prisma/enums";
import { loadDashboard } from "@/lib/dashboard-data";
import { foundPostingSchema, type FoundPosting, type ShownPosting } from "@/lib/job-search/search";
import { loadSearch } from "@/lib/posting-searches";
import { dismissPosting, foundFromPosting, postingStates, savePosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { advance } from "@/lib/status";

const text = (value: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const failure = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }], isError: true });
const id = z.string().trim().min(1).max(100);
const page = { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(30) };
const reference = z.object({ posting_id: id.optional(), search_id: id.optional(), number: z.number().int().min(1).optional() }).refine(
  (input) => Boolean(input.posting_id) !== Boolean(input.search_id && input.number),
  "Give either posting_id, or search_id and number.",
);

async function foundPosting(input: z.output<typeof reference>): Promise<FoundPosting | null> {
  if (input.posting_id) {
    const row = await prisma.posting.findUnique({ where: { id: input.posting_id } });
    return row ? foundFromPosting(row) : null;
  }
  const search = await prisma.postingSearch.findUnique({ where: { id: input.search_id! }, select: { postings: true } });
  return foundPostingSchema.array().catch([]).parse(search?.postings ?? [])[input.number! - 1] ?? null;
}

function jobSummary(posting: FoundPosting | ShownPosting) {
  return {
    source: posting.source, external_id: posting.externalId, title: posting.title, company: posting.company,
    place: posting.place, remote: posting.remote, salary: posting.salary, url: posting.url, posted_at: posting.postedAt,
    snippet: posting.description.replace(/\s+/g, " ").slice(0, 280),
    ...("state" in posting ? { state: posting.state } : {}),
  };
}

const details = z.object({
  title: z.string().trim().max(500).optional(),
  company: z.string().trim().min(1).max(300),
  role: z.string().trim().min(1).max(300),
  location: z.string().trim().max(300).optional(),
  mode: z.string().trim().max(100).optional(),
  salary: z.string().trim().max(200).optional(),
  deadline: z.iso.date().nullable().optional(),
  posting_url: z.url({ protocol: /^https?$/ }).max(2000).optional(),
});

/** Management tools share the existing OAuth endpoint and domain helpers with the UI. */
export function registerManagementTools(server: McpServer, origin: string) {
  const link = (path: string) => `${origin}${path}`;

  server.registerTool("get_dashboard", {
    title: "Read the job search dashboard",
    description: "Application totals by status, funnel, activity, deadlines, follow-ups and upcoming interviews, using HireMe's dashboard rules.",
    inputSchema: z.object({ period: z.enum(["30d", "90d", "all"]).default("all") }),
    annotations: { readOnlyHint: true },
  }, async ({ period }) => {
    const settings = await loadSettings();
    return text({ ...await loadDashboard({ period, quietDays: settings.quietDays, timeZone: settings.browserTimeZone ?? undefined }), link: link("/") });
  });

  server.registerTool("list_job_searches", {
    title: "Read past job searches",
    description: "Pull previously run searches without using a job source request. Use a search_id with list_jobs to retrieve its postings.",
    inputSchema: z.object(page), annotations: { readOnlyHint: true },
  }, async ({ offset, limit }) => {
    const rows = await prisma.postingSearch.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: offset, take: limit + 1,
      select: { id: true, source: true, query: true, found: true, createdAt: true } });
    return text({ searches: rows.slice(0, limit), next_offset: rows.length > limit ? offset + limit : null });
  });

  server.registerTool("list_jobs", {
    title: "Pull saved jobs or a past search",
    description: "Read saved or dismissed jobs, or postings from a search_id. No new external search. Returns posting ids for saved jobs and original search numbers for search results.",
    inputSchema: z.object({ ...page, view: z.enum(["saved", "dismissed"]).default("saved"), search_id: id.optional() }),
    annotations: { readOnlyHint: true },
  }, async ({ offset, limit, view, search_id }) => {
    if (search_id) {
      const search = await loadSearch(search_id);
      if (!search) return failure("That search is no longer kept. Search again.");
      return text({ search_id, jobs: search.postings.slice(offset, offset + limit).map((posting, index) => ({ ...jobSummary(posting), number: offset + index + 1 })),
        next_offset: search.postings.length > offset + limit ? offset + limit : null, more_available: search.next !== null });
    }
    const rows = await prisma.posting.findMany({ where: view === "saved" ? { savedAt: { not: null } } : { dismissedAt: { not: null } },
      orderBy: view === "saved" ? [{ savedAt: "desc" }, { id: "desc" }] : [{ dismissedAt: "desc" }, { id: "desc" }], skip: offset, take: limit + 1 });
    const shown = rows.slice(0, limit);
    const states = await postingStates(shown);
    return text({ jobs: shown.map((row) => ({ posting_id: row.id, ...jobSummary(foundFromPosting(row)), state: states.get(`${row.source}:${row.externalId}`) })),
      next_offset: rows.length > limit ? offset + limit : null, link: link(`/jobs?view=${view}`) });
  });

  server.registerTool("set_job_state", {
    title: "Save, dismiss or restore a job",
    description: "Save a posting for later, dismiss it from future searches, or restore a dismissed posting to Saved. Uses a posting_id or search_id and number.",
    inputSchema: reference.safeExtend({ state: z.enum(["saved", "dismissed"]) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ state, ...ref }) => {
    const posting = await foundPosting(ref);
    if (!posting) return failure("That posting no longer exists. Use a posting_id or a number from an existing search.");
    if (state === "saved") {
      const row = await savePosting(posting);
      return text({ posting_id: row.id, state });
    }
    await dismissPosting(posting);
    return text({ state });
  });

  server.registerTool("track_application", {
    title: "Record an existing application",
    description: "Add a tracking card without generating a resume or sending anything. SENT means the user already applied; REJECTED records a rejection. " +
      "Reuse the same idempotency_key when retrying to avoid duplicates. Optionally link a stored posting; an already linked posting returns its existing application.",
    inputSchema: details.extend({ idempotency_key: z.string().trim().min(1).max(200), posting_id: id.optional(),
      posting_text: z.string().max(100_000).default(""), status: z.enum(ApplicationStatus).default("DRAFT"), note: z.string().trim().max(5000).optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const applicationId = `mcp-${createHash("sha256").update(input.idempotency_key).digest("hex")}`;
    const result = await prisma.$transaction(async (tx) => {
      // Serialize retries and two clients tracking the same saved posting.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${applicationId}, 0))::text`;
      if (input.posting_id) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.posting_id}, 0))::text`;
      const existing = await tx.application.findUnique({ where: { id: applicationId }, select: { id: true, status: true } });
      if (existing) return { ...existing, created: false };
      const posting = input.posting_id ? await tx.posting.findUnique({ where: { id: input.posting_id } }) : null;
      if (input.posting_id && !posting) return null;
      if (posting?.applicationId) {
        const linked = await tx.application.findUniqueOrThrow({ where: { id: posting.applicationId }, select: { id: true, status: true } });
        return { ...linked, created: false };
      }
      const now = new Date();
      const change = advance({ status: ApplicationStatus.DRAFT, furthestStage: null, sentAt: null }, input.status, now);
      const row = await tx.application.create({ data: {
        id: applicationId, company: input.company, role: input.role, title: input.title || `${input.role} · ${input.company}`,
        location: input.location ?? posting?.place ?? "", mode: input.mode ?? "", salary: input.salary ?? posting?.salary ?? "",
        deadline: input.deadline ? new Date(`${input.deadline}T00:00:00Z`) : null,
        postingUrl: input.posting_url ?? posting?.url ?? "", postingText: input.posting_text || posting?.description || "",
        ...(change ? { ...change.update, events: { create: change.event } } : {}),
        ...(input.note ? { notes: { create: { body: input.note } } } : {}),
      }, select: { id: true, status: true } });
      if (posting) await tx.posting.update({ where: { id: posting.id }, data: { applicationId: row.id } });
      return { ...row, created: true };
    });
    return result ? text({ ...result, link: link(`/applications/${result.id}`) }) : failure("That posting no longer exists.");
  });

  server.registerTool("update_application", {
    title: "Edit an application's details",
    description: "Update supplied fields on a tracking card; omitted fields stay as they are. Set deadline to null to clear it. Use set_application_status to move the card.",
    inputSchema: details.partial().extend({ id }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id, deadline, posting_url, ...fields }) => {
    const result = await prisma.application.updateMany({ where: { id, awaitingReview: false }, data: {
      ...fields, ...(posting_url !== undefined ? { postingUrl: posting_url } : {}),
      ...(deadline !== undefined ? { deadline: deadline ? new Date(`${deadline}T00:00:00Z`) : null } : {}),
    } });
    return result.count ? text({ id, updated: true, link: link(`/applications/${id}`) }) : failure("That application no longer exists.");
  });

  server.registerTool("set_application_archived", {
    title: "Archive or restore an application",
    description: "Hide a card from the active board, or restore it. Keeps its documents and status history.",
    inputSchema: z.object({ id, archived: z.boolean() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id, archived }) => {
    // Preserve the activity date, matching the board's archive action.
    const rows = await prisma.$executeRaw`UPDATE "Application" SET "archivedAt" = ${archived ? new Date() : null} WHERE id = ${id} AND "awaitingReview" = false`;
    return rows ? text({ id, archived }) : failure("That application no longer exists.");
  });

  server.registerTool("get_application_history", {
    title: "Read application status history",
    description: "Read status transitions for an application, including when it was applied or rejected. Private notes are excluded.",
    inputSchema: z.object({ id, ...page }), annotations: { readOnlyHint: true },
  }, async ({ id, offset, limit }) => {
    if (!(await prisma.application.count({ where: { id, awaitingReview: false } }))) return failure("That application no longer exists.");
    const rows = await prisma.statusEvent.findMany({ where: { applicationId: id }, orderBy: [{ at: "desc" }, { id: "desc" }], skip: offset, take: limit + 1 });
    return text({ id, events: rows.slice(0, limit), next_offset: rows.length > limit ? offset + limit : null });
  });
}
