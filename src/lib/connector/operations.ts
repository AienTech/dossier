import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { DocumentKind, JobStatus } from "@/generated/prisma/enums";
import { unitsSchema } from "@/lib/application-data";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { getJob, retryJob, cancelJob } from "@/lib/jobs/runner";
import { countryCodeFor } from "@/lib/job-search/countries";
import { loadSearch, runSearch, showMoreFor } from "@/lib/posting-searches";
import { DEFAULT_RADIUS_KM } from "@/lib/job-search/search";
import { postingStates } from "@/lib/postings";
import { audit, clientKey, PERMISSIONS, permissionNames, requirePermission, requestDelegation, type Permission } from "./delegation";
import { basicsPatch, editBasics, editEntry, editSettings, entryPatch, publicSettings, settingsPatch } from "./routine";
import { canonicalPostingUrl, recordExternalApplication, recordSubmission } from "./submission";
import { approvedSubmissionPacket, createApproval, finishSubmission, readApproval } from "./approvals";
import { connectorSince } from "./oauth";
import { workerWindowLabel } from "@/lib/worker-scaling";

const id = z.string().min(1).max(100);
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
/** Never return arbitrary exception/provider output, which may contain credentials. */
export function errorCategory(message: string | null): string | null {
  if (!message) return null;
  if (/cancel/i.test(message)) return "Cancelled";
  if (/restart|interrupt/i.test(message)) return "Interrupted; retry is available";
  if (/rate|quota|limit/i.test(message)) return "Provider rate or usage limit";
  if (/timeout|timed out/i.test(message)) return "Provider timeout";
  if (/auth|api key|credential/i.test(message)) return "Provider authentication failed; review settings in HireMe";
  return "Task failed; inspect its private details in HireMe";
}
export function registerDelegationTools(server: McpServer, origin: string, clientId: string) {
  const link = (path: string) => `${origin}${path}`;
  function tool<S extends z.ZodRawShape>(name: string, description: string, permission: Permission | null, schema: z.ZodObject<S>, work: (input: z.output<z.ZodObject<S>>, key: string) => Promise<unknown>, readOnly = false) {
    server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint: readOnly, destructiveHint: false } }, async input => {
      try {
        const key = permission ? await requirePermission(clientId, permission) : clientKey(clientId);
        const result = await work(schema.parse(input), key);
        if (permission && !readOnly) { await audit(key, name); revalidatePath("/", "layout"); }
        return text(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        // Only permission errors are safe to return verbatim. Other failure details remain on the server.
        return { ...text({ error: message.startsWith("Permission ") ? message : "The operation could not be completed. Check the supplied fields or review HireMe's private logs." }), isError: true };
      }
    });
  }
  tool("request_delegation", "Request explicit per-app permissions. The signed-in owner must approve at the review URL; this tool never grants access.", null, z.object({ permissions: z.array(z.enum(permissionNames)).min(1).max(permissionNames.length) }), async ({ permissions }) => ({ ...await requestDelegation(clientId, permissions), review_url: link("/delegations") }));
  tool("get_delegation", "List this app's granted/requested permissions and approval requirements.", null, z.object({}), async () => {
    const grant = await prisma.connectorGrant.findUnique({ where: { id: clientKey(clientId) } });
    const current = Boolean(grant && grant.generation === await connectorSince());
    return { available: PERMISSIONS, granted: current ? grant!.permissions : [], requested: grant?.requested ?? [], owner_reviewed: current && Boolean(grant?.approvedAt), review_url: link("/delegations"), secrets_accessible: false };
  }, true);
  tool("get_private_profile", "Read the full profile including contact details and references, after explicit private-read permission.", "private_read", z.object({}), async () => loadProfile(), true);
  tool("update_profile_basics", "Update only supplied profile fields. Never invent qualifications or experience.", "profile_edit", z.object({ changes: basicsPatch }), async ({ changes }) => { await editBasics(changes); return { updated: true, link: link("/profile") }; });
  tool("upsert_profile_entry", "Add or edit experience, projects, education, skills, languages, publications, references or facts. An id edits an existing entry; omission adds one.", "profile_edit", z.object({ entry: entryPatch }), async ({ entry }) => { const row = await editEntry(entry); return { id: "skill" in row ? row.skill.id : row.id, updated: true }; });
  tool("get_nonsecret_settings", "Read approved document/model/agent preferences; no keys, credentials, URLs or security settings.", "settings_edit", z.object({}), async () => publicSettings(), true);
  tool("update_nonsecret_settings", "Change approved model, document and daily-agent preferences. Cannot change secrets, credential destinations, connector permissions or security.", "settings_edit", z.object({ changes: settingsPatch }), async ({ changes }) => { await editSettings(changes); return { updated: true }; });
  tool("list_background_jobs", "Inspect all AI/runner jobs without exposing raw inputs, results or credentials. Statuses distinguish queued, running, done and failed.", "jobs_manage", z.object({ status: z.enum(JobStatus).optional(), type: z.string().max(100).optional(), application_id: id.optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(30) }), async ({ status, type, application_id, offset, limit }) => {
    const jobs = await prisma.job.findMany({ where: { status, type, applicationId: application_id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: offset, take: limit + 1, select: { id: true, type: true, status: true, applicationId: true, step: true, error: true, createdAt: true, startedAt: true, finishedAt: true } });
    const heartbeat = await prisma.setting.findUnique({ where: { key: "workerHeartbeat" } });
    return { jobs: jobs.slice(0, limit).map(({ error, ...job }) => ({ ...job, error: errorCategory(error) })), next_offset: jobs.length > limit ? offset + limit : null, worker_last_seen: heartbeat?.value ?? null, worker_window: workerWindowLabel(), note: "No raw job inputs or results are exposed. Search history is available via list_job_searches." };
  }, true);
  tool("control_background_job", "Retry a failed job or cancel a queued/running job. Retrying may consume AI/search quota; never retry repeatedly without inspecting its status.", "jobs_manage", z.object({ id, operation: z.enum(["retry", "cancel"]) }), async ({ id, operation }) => {
    const job = await getJob(id); if (!job) throw new Error("No such job");
    if (operation === "retry") return { id, retried: await retryJob(id) };
    await cancelJob(id); return { id, status: (await getJob(id))?.status };
  });
  tool("search_job_batch", "Run up to six role/location searches, up to three pages each. Each page consumes search quota. Deduplicate results and exclude already-applied/dismissed postings. More unique jobs is not a guarantee of eligibility; score full postings before applying.", "job_search", z.object({ queries: z.array(z.object({ keywords: z.string().trim().min(1).max(200), country: z.string().max(60).optional(), place: z.string().max(200).optional(), remote_only: z.boolean().default(false), posted_within: z.enum(["any", "day", "3days", "week", "month"]).default("week") })).min(1).max(6), pages_per_query: z.number().int().min(1).max(3).default(1) }), async ({ queries, pages_per_query }) => {
    const profile = await loadProfile(); const seen = new Set<string>(); const results = []; const jobs = [];
    for (const query of queries) {
      const country = countryCodeFor(query.country ?? profile.basics.country); if (!country) { results.push({ keywords: query.keywords, error: "Choose a supported country" }); continue; }
      const ran = await runSearch({ keywords: query.keywords, country, place: query.remote_only ? "" : query.place ?? profile.basics.city, remoteOnly: query.remote_only, radiusKm: DEFAULT_RADIUS_KM, postedWithin: query.posted_within });
      if (!ran.ok) { results.push({ keywords: query.keywords, error: "Search failed; check the source's quota and configuration in HireMe" }); continue; }
      for (let page = 1; page < pages_per_query; page++) { const current = await loadSearch(ran.id); if (!current?.next) break; const more = await showMoreFor(ran.id); if (!more.ok) break; }
      const search = await loadSearch(ran.id); if (!search) continue;
      const states = await postingStates(search.postings);
      for (const [index, posting] of search.postings.entries()) {
        const state = states.get(`${posting.source}:${posting.externalId}`); if (state?.applicationId || state?.dismissed) continue;
        const canonical = posting.url ? canonicalPostingUrl(posting.url) : `${posting.company}|${posting.title}|${posting.place}`.toLowerCase();
        if (seen.has(canonical)) continue; seen.add(canonical);
        jobs.push({ search_id: ran.id, number: index + 1, title: posting.title, company: posting.company, place: posting.place, remote: posting.remote, url: posting.url, snippet: posting.description.slice(0, 500), fit: state?.score ?? null });
      }
      results.push({ search_id: ran.id, keywords: query.keywords, found: search.postings.length, more_available: Boolean(search.next) });
    }
    return { searches: results, unique_jobs: jobs.length, jobs };
  });
  tool("record_external_application", "Create or enrich a complete manual/bot tracking record. Use the actual submitted date, text and original files; never label newly generated drafts as submitted. confirmed=false stays a draft; confirmed=true requires submitted_at. Reuse idempotency_key and existing id to avoid duplicates.", "applications_edit", z.object({ application: recordSubmission }), async ({ application }) => { const result = await recordExternalApplication(application); return { ...result, link: link(`/applications/${result.id}`) }; });
  tool("get_application_private", "Read an application's private notes, submitted document text, recruiter contacts and receipt details. Requires private-read permission.", "private_read", z.object({ id }), async ({ id }) => {
    const application = await prisma.application.findUnique({ where: { id }, select: { id: true, company: true, role: true, postingText: true, postingUrl: true, submission: true, notes: { orderBy: { createdAt: "asc" } } } });
    if (!application) throw new Error("Not found"); return { ...application, link: link(`/applications/${id}`) };
  }, true);
  tool("edit_application_note", "Update an existing private note, preserving the rest of the application.", "applications_edit", z.object({ application_id: id, note_id: id, body: z.string().trim().min(1).max(5000) }), async ({ application_id, note_id, body }) => ({ updated: (await prisma.note.updateMany({ where: { id: note_id, applicationId: application_id }, data: { body } })).count === 1 }));
  tool("update_application_document", "Save supplied document units on an existing application, preserving its previous version. This edits a draft, never the immutable actual-submission snapshot. Use only facts supplied by the user/profile.", "applications_edit", z.object({ application_id: id, kind: z.enum(DocumentKind), units: unitsSchema.max(100) }), async ({ application_id, kind, units }) => {
    if (units.some(unit => unit.text.length > 100000)) throw new Error("Document too large");
    const result = await prisma.$transaction(async tx => {
      const app = await tx.application.findUnique({ where: { id: application_id } }); if (!app) throw new Error("Application missing");
      const previous = await tx.document.findUnique({ where: { applicationId_kind: { applicationId: application_id, kind } } });
      if (previous) await tx.documentVersion.create({ data: { documentId: previous.id, units: previous.units as Prisma.InputJsonValue, cause: "BEFORE_RESTORE", detail: "Before MCP edit" } });
      const doc = await tx.document.upsert({ where: { applicationId_kind: { applicationId: application_id, kind } }, create: { applicationId: application_id, kind, units, writtenWith: "mcp-client" }, update: { units, writtenWith: "mcp-client" } });
      await tx.documentVersion.create({ data: { documentId: doc.id, units, cause: "REFINED", detail: "Edited through MCP" } });
      await tx.application.update({ where: { id: application_id }, data: { updatedAt: new Date() } });
      return { document_id: doc.id, updated: true, link: link(`/applications/${application_id}`) };
    }); return result;
  });
  tool("request_application_deletion", "Request a permanent deletion review. Does not delete anything; only the signed-in owner can approve the exact application in HireMe.", "delete_request", z.object({ application_id: id }), async (input, key) => createApproval(key, "delete", input, origin));
  tool("request_application_email", "Prepare an immutable email and attachment snapshot for owner approval. Does not send; recipients, body and attachments must be reviewed in HireMe.", "email_request", z.object({ application_id: id, to: z.email(), subject: z.string().trim().min(1).max(500), body: z.string().min(1).max(20000), attach_documents: z.boolean().default(true) }), async (input, key) => createApproval(key, "email", input, origin));
  tool("request_external_submission", "Prepare an external-site handoff for owner approval. The external browser agent must read the approved snapshot before submitting. This tool itself never visits or submits a website.", "submit_request", z.object({ application_id: id, target_url: z.url({ protocol: /^https?$/ }).max(2000), answers: z.record(z.string().max(200), z.string().max(10000)).refine(x => Object.keys(x).length <= 100) }), async (input, key) => createApproval(key, "submit", input, origin));
  tool("get_approved_submission_packet", "Get only the frozen files and answers of this app’s owner-approved, unexpired handoff. Never substitute new documents or changed answers.", "submit_request", z.object({ approval_id: id }), async ({ approval_id }, key) => approvedSubmissionPacket(key, approval_id), true);
  tool("record_submission_outcome", "Record whether an approved external handoff actually succeeded. A failed/unconfirmed attempt never marks the application Sent.", "submit_request", z.object({ approval_id: id, confirmed: z.boolean(), submitted_at: z.iso.datetime().optional(), confirmation_reference: z.string().max(1000).optional(), failure: z.string().max(2000).optional() }).refine(x => !x.confirmed || Boolean(x.submitted_at), "Confirmed submissions need their actual date"), async ({ approval_id, ...outcome }, key) => finishSubmission(key, approval_id, outcome));
  tool("get_action_approval", "Read this client's action-review status. Approved external handoffs include the exact approved payload. Cannot approve, modify or execute an email/deletion.", null, z.object({ approval_id: id }), async ({ approval_id }, key) => readApproval(key, approval_id), true);
}
