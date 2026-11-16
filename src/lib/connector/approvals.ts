import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { submissionSnapshot } from "@/lib/submission-data";
import { unitsSchema } from "@/lib/application-data";
import { prisma } from "@/lib/prisma";
import { loadGoogleAccount } from "@/lib/google/account";
import { sendMail } from "@/lib/google/gmail";
import { renderPdf } from "@/lib/pdf/render";
import { loadProfileName } from "@/lib/profile-data";
import { readStoredFile, storeFile } from "@/lib/stored-files";
import { cancelApplicationJobs } from "@/lib/jobs/runner";
import { writeBackup } from "@/lib/backups";
import { applyStatusChange } from "@/lib/status-changes";
import { audit, type Permission } from "./delegation";
import { connectorSince } from "./oauth";

type FileRef = { key: string; filename: string; sha256: string; bytes: number; contentType: string; kind?: "resume" | "cover_letter"; text?: string };
type Review = { application_id: string; company: string; role: string; updated_at: string; revision: string; generation: string; to?: string; from?: string; subject?: string; body?: string; target_url?: string; answers?: Record<string, string>; files: FileRef[]; deletes?: { documents: number; notes: number; messages: number } };
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export const snapshotDigest = (value: unknown) => digest(JSON.stringify(canonical(JSON.parse(JSON.stringify(value)))));
const permissionFor = (action: string): Permission => action === "email" ? "email_request" : action === "delete" ? "delete_request" : "submit_request";
async function clientStillAllowed(clientId: string, action: string, generation: string) {
  const grant = await prisma.connectorGrant.findUnique({ where: { id: clientId } });
  return generation === await connectorSince() && grant?.generation === generation && grant.approvedAt && Array.isArray(grant.permissions) && grant.permissions.includes(permissionFor(action));
}
async function applicationRevision(id: string, db: Prisma.TransactionClient = prisma) {
  const app = await db.application.findUnique({ where: { id }, include: {
    documents: { orderBy: { id: "asc" }, include: { versions: { orderBy: { id: "asc" } } } },
    notes: { orderBy: { id: "asc" } }, messages: { orderBy: { id: "asc" } }, events: { orderBy: { id: "asc" } }, facts: { orderBy: { id: "asc" } }, emails: { orderBy: { id: "asc" } },
  } });
  if (!app) return null;
  // Archive bookkeeping does not change the owner-reviewed application.
  const snapshot = { ...app };
  Reflect.deleteProperty(snapshot, "driveSync");
  return snapshotDigest(snapshot);
}
export async function createApproval(clientId: string, action: "email" | "delete" | "submit", input: { application_id: string; to?: string; subject?: string; body?: string; attach_documents?: boolean; target_url?: string; answers?: Record<string, string> }, origin: string) {
  const app = await prisma.application.findUnique({ where: { id: input.application_id }, include: { documents: true, _count: { select: { documents: true, notes: true, messages: true } } } });
  if (!app) throw new Error("Application missing");
  const generation = await connectorSince(); if (!generation) throw new Error("Connector disabled");
  const payload: Review = { application_id: app.id, company: app.company, role: app.role, updated_at: app.updatedAt.toISOString(), revision: (await applicationRevision(app.id))!, generation, files: [] };
  if (action === "email") {
    const account = await loadGoogleAccount(); if (!account) throw new Error("Connect Google first");
    payload.to = input.to; payload.subject = input.subject; payload.body = input.body;
    payload.from = `${(await loadProfileName()).replace(/[<>"\r\n]/g, "")} <${account.email}>`;
  }
  if ((action === "email" && input.attach_documents) || action === "submit") {
      for (const [kind, path, filename] of [["RESUME", "resume", "resume.pdf"], ["COVER_LETTER", "letter", "cover-letter.pdf"]] as const) {
        if (!app.documents.some(doc => doc.kind === kind)) continue;
        const bytes = await renderPdf(`/print/${path}/${app.id}`); const sha = digest(bytes); const key = `${app.id}-${sha}`;
        await storeFile("approval-attachments", key, bytes);
        const units = unitsSchema.parse(app.documents.find(doc => doc.kind === kind)?.units ?? []);
        payload.files.push({ key, filename, sha256: sha, bytes: bytes.length, contentType: "application/pdf", kind: path === "resume" ? "resume" : "cover_letter", text: units.map(unit => `${unit.label || unit.id}\n${unit.text}`).join("\n\n") });
      }
      // Imported originals are attached as uploaded. Plain submitted text is
      // never silently turned into a newly generated "submitted" PDF.
      const submission = submissionSnapshot.safeParse(app.submission);
      for (const file of (submission.success ? submission.data.documents : []) ?? []) {
        if (!file.file_key || file.kind === "email" || payload.files.some(item => item.kind === file.kind)) continue;
        const bytes = await readStoredFile("submission-files", file.file_key); if (!bytes || digest(bytes) !== file.sha256) throw new Error("An original attachment is unavailable");
        const key = `${app.id}-${file.sha256}`; await storeFile("approval-attachments", key, bytes);
        payload.files.push({ key, filename: file.filename ?? "submitted-document", sha256: file.sha256, bytes: bytes.length, contentType: file.content_type ?? "application/octet-stream", kind: file.kind, text: file.text });
      }
  }
  if (action === "delete") payload.deletes = app._count;
  if (action === "submit") { payload.target_url = input.target_url; payload.answers = input.answers; }
  const approval = await prisma.connectorApproval.create({ data: { clientId, action, payload: json(payload), digest: snapshotDigest(payload), expiresAt: new Date(Date.now() + 30 * 60_000) } });
  await audit(clientId, `request_${action}`, app.id, "pending");
  return { approval_id: approval.id, status: approval.status, expires_at: approval.expiresAt, review_url: `${origin}/delegations/approvals/${approval.id}`, next: "The owner must review and approve in HireMe. A tool argument cannot substitute for that approval." };
}
export async function readApproval(clientId: string, id: string) {
  const row = await prisma.connectorApproval.findFirst({ where: { id, clientId } });
  if (!row) throw new Error("Approval missing");
  const expired = row.expiresAt <= new Date();
  const payload = row.payload as unknown as Review;
  const allowed = await clientStillAllowed(clientId, row.action, payload.generation);
  if (!allowed) throw new Error("Permission revoked");
  const unchanged = row.action !== "submit" || await applicationRevision(payload.application_id) === payload.revision;
  return { id, action: row.action, status: expired && row.status === "PENDING" ? "EXPIRED" : row.status, expires_at: row.expiresAt, result: row.result,
    ...(row.action === "submit" && row.status === "APPROVED" && !expired && allowed && unchanged ? { approved_payload: payload, digest: row.digest, instruction: "Only submit this exact payload. Login, CAPTCHA and site-specific requirements still apply. Record the actual outcome in HireMe afterward." } : {}) };
}
/** Called only by authenticated browser Server Actions, never registered as MCP. */
export async function resolveApproval(id: string, approve: boolean) {
  const row = await prisma.connectorApproval.findUnique({ where: { id } });
  if (!row || row.status !== "PENDING" || row.expiresAt <= new Date()) throw new Error("This review expired or was already handled.");
  if (!approve) { await prisma.connectorApproval.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED" } }); await audit(row.clientId, row.action, id, "rejected"); return; }
  const payload = row.payload as unknown as Review;
  if (snapshotDigest(payload) !== row.digest || !(await clientStillAllowed(row.clientId, row.action, payload.generation))) throw new Error("Permissions changed. Request a new review.");
  const app = await prisma.application.findUnique({ where: { id: payload.application_id }, select: { updatedAt: true } });
  if (!app || app.updatedAt.toISOString() !== payload.updated_at || await applicationRevision(payload.application_id) !== payload.revision) throw new Error("The application changed. Request a new review.");
  const claimed = await prisma.connectorApproval.updateMany({ where: { id, status: "PENDING", expiresAt: { gt: new Date() } }, data: { status: row.action === "submit" ? "APPROVED" : "EXECUTING" } });
  if (!claimed.count) throw new Error("This review was already handled.");
  if (row.action === "submit") { await audit(row.clientId, "submit", payload.application_id, "approved_handoff"); return; }
  try {
    let result: unknown;
    if (row.action === "delete") {
      const backup = await writeBackup("before-delete");
      await cancelApplicationJobs(payload.application_id);
      // Recheck after the backup; do not delete a card edited in the meantime.
      await prisma.$transaction(async tx => {
        if (await applicationRevision(payload.application_id, tx) !== payload.revision) throw new Error("Application changed");
        await tx.application.delete({ where: { id: payload.application_id } });
      }, { isolationLevel: "Serializable", timeout: 30000 });
      result = { deleted: true, backup };
    } else {
      const account = await loadGoogleAccount();
      if (!account || !payload.from?.endsWith(`<${account.email}>`)) throw new Error("Google account changed");
      const attachments = await Promise.all(payload.files.map(async file => {
        const data = await readStoredFile("approval-attachments", file.key);
        if (!data || digest(data) !== file.sha256) throw new Error("Approved attachment changed");
        return { fileName: file.filename, contentType: file.contentType, data };
      }));
      // Sending uses only the frozen recipient, text and bytes shown for approval.
      const sent = await sendMail({ from: payload.from!, to: payload.to!, subject: payload.subject!, body: payload.body!, attachments });
      result = { sent: true, gmail_id: sent.id, thread_id: sent.threadId };
      await prisma.emailMessage.create({ data: { gmailId: sent.id, threadId: sent.threadId, applicationId: payload.application_id, direction: "OUTGOING", fromAddress: account.email, toAddress: payload.to!, subject: payload.subject!, body: payload.body!, sentAt: new Date(), handledAt: new Date() } });
      await prisma.application.update({ where: { id: payload.application_id }, data: { emailThreadId: sent.threadId } });
      const current = await prisma.application.findUnique({ where: { id: payload.application_id } });
      if (current?.status === "DRAFT") await applyStatusChange(prisma, current.id, "SENT");
    }
    await prisma.connectorApproval.update({ where: { id }, data: { status: "DONE", result: json(result) } });
    await audit(row.clientId, row.action, payload.application_id);
  } catch {
    // A provider may have accepted an email before a response/DB failure.
    // Never offer automatic replay of this approval and risk a duplicate send.
    await prisma.connectorApproval.update({ where: { id }, data: { status: "NEEDS_REVIEW", result: { message: "The outcome needs manual verification. Check Gmail/HireMe before making another request." } } });
    await audit(row.clientId, row.action, payload.application_id, "needs_review");
    throw new Error("The action needs manual verification. Check its status before requesting it again.");
  }
}

/** Frozen external-site packet. This is a handoff, not a website submitter. */
export async function approvedSubmissionPacket(clientId: string, id: string) {
  const review = await readApproval(clientId, id);
  if (!review.approved_payload || review.status !== "APPROVED") throw new Error("No current approved handoff");
  const files = await Promise.all(review.approved_payload.files.map(async file => {
    const bytes = await readStoredFile("approval-attachments", file.key);
    if (!bytes || digest(bytes) !== file.sha256) throw new Error("Snapshot unavailable");
    return { filename: file.filename, content_type: file.contentType, sha256: file.sha256, base64: Buffer.from(bytes).toString("base64") };
  }));
  return { approval_id: id, digest: review.digest, payload: review.approved_payload, files, expires_at: review.expires_at };
}
export async function finishSubmission(clientId: string, id: string, outcome: { confirmed: boolean; submitted_at?: string; confirmation_reference?: string; failure?: string }) {
  const review = await readApproval(clientId, id);
  if (review.action !== "submit") throw new Error("This review is not a submission handoff");
  if (outcome.confirmed && (!outcome.submitted_at || !Number.isFinite(Date.parse(outcome.submitted_at)))) throw new Error("Confirmed submissions need their actual date");
  if (review.status === "DONE") return { recorded: true, duplicate: true };
  if (!review.approved_payload || review.status !== "APPROVED") throw new Error("No current approved handoff");
  const payload = review.approved_payload;
  const documents: { kind: "resume" | "cover_letter"; text: string; filename: string; file_key: string; content_type: string; sha256: string }[] = [];
  for (const file of payload.files) {
    const data = await readStoredFile("approval-attachments", file.key); if (!data || digest(data) !== file.sha256) throw new Error("Snapshot unavailable");
    const key = `${payload.application_id}-${file.sha256}`; await storeFile("submission-files", key, data);
    documents.push({ kind: file.kind ?? "resume", text: file.text ?? "Original file supplied with the approved handoff.", filename: file.filename, file_key: key, content_type: file.contentType, sha256: file.sha256 });
  }
  await prisma.$transaction(async tx => {
    const claimed = await tx.connectorApproval.updateMany({ where: { id, clientId, status: "APPROVED", expiresAt: { gt: new Date() } }, data: { status: "DONE", result: json(outcome) } });
    if (!claimed.count) throw new Error("This handoff was already recorded or expired");
    const app = await tx.application.findUnique({ where: { id: payload.application_id } }); if (!app) throw new Error("Application missing");
    if (await applicationRevision(app.id, tx) !== payload.revision) throw new Error("The application changed. Request a new review.");
    if (outcome.confirmed) {
      await tx.application.update({ where: { id: app.id }, data: { submission: json({ source: "bot", confirmed: true, submitted_at: outcome.submitted_at, confirmation_reference: outcome.confirmation_reference, confirmation_url: payload.target_url, documents }) } });
      if (app.status === "DRAFT") {
        const { advance } = await import("@/lib/status"); const change = advance(app, "SENT", new Date(outcome.submitted_at!));
        if (change) await tx.application.update({ where: { id: app.id }, data: { ...change.update, events: { create: change.event } } });
      }
    } else await tx.note.create({ data: { applicationId: app.id, body: `External submission not confirmed: ${outcome.failure ?? "The bot did not confirm success."}` } });
  });
  await audit(clientId, "submission_outcome", payload.application_id, outcome.confirmed ? "confirmed" : "not_confirmed");
  return { recorded: true, application_id: payload.application_id, confirmed: outcome.confirmed };
}
