import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { advance } from "@/lib/status";
import { storeFile } from "@/lib/stored-files";

const text = (n: number) => z.string().trim().max(n);
export const submissionDocument = z.strictObject({ kind: z.enum(["resume", "cover_letter", "email"]), text: z.string().min(1).max(100_000), filename: text(200).optional(), base64: z.string().max(1_500_000).optional(), content_type: z.enum(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"]).optional() });
export const recordSubmission = z.strictObject({
  id: text(100).optional(), idempotency_key: text(200).min(1), company: text(300).min(1), role: text(300).min(1),
  posting_url: z.url({ protocol: /^https?$/ }).max(2000).optional(), posting_text: z.string().max(100_000).optional(), location: text(300).optional(), mode: text(100).optional(), salary: text(200).optional(), deadline: z.iso.date().nullable().optional(),
  source: z.enum(["manual", "bot"]), bot: text(100).optional(), confirmed: z.boolean(), submitted_at: z.iso.datetime().optional(), confirmation_reference: text(1000).optional(), confirmation_url: z.url({ protocol: /^https?$/ }).max(2000).optional(),
  recruiter: z.strictObject({ name: text(200).optional(), email: z.email().optional(), phone: text(60).optional() }).optional(),
  documents: z.array(submissionDocument).max(3).optional(), note: text(5000).optional(),
}).refine(x => !x.confirmed || Boolean(x.submitted_at), "A confirmed submission needs its actual submitted_at date.")
  .refine(x => !x.documents || new Set(x.documents.map(d => d.kind)).size === x.documents.length, "Provide only one submitted document per kind.");
const hash = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
export function canonicalPostingUrl(value: string) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) url.searchParams.delete(key);
  url.hash = ""; url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort(); return url.toString().replace(/\/$/, "");
}
export type SubmissionInfo = { source: string; bot?: string; confirmed: boolean; submitted_at?: string; confirmation_reference?: string; confirmation_url?: string; recruiter?: { name?: string; email?: string; phone?: string }; documents?: { kind: string; text: string; filename?: string; file_key?: string; content_type?: string; sha256: string }[] };
export async function recordExternalApplication(raw: z.infer<typeof recordSubmission>) {
  const input = recordSubmission.parse(raw);
  const postingUrl = input.posting_url ? canonicalPostingUrl(input.posting_url) : undefined;
  const deterministicId = `mcp-${hash(input.idempotency_key)}`;
  const lock = postingUrl ? `${postingUrl}|${input.company.toLowerCase()}|${input.role.toLowerCase()}` : deterministicId;
  const docs: NonNullable<SubmissionInfo["documents"]> = [];
  let total = 0;
  for (const document of input.documents ?? []) {
    let fileKey: string | undefined;
    let digest = hash(document.text);
    if (document.base64) {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(document.base64) || document.base64.length % 4 !== 0) throw new Error("Document base64 is invalid.");
      const bytes = Buffer.from(document.base64, "base64"); total += bytes.length;
      if (!bytes.length || total > 2 * 1024 * 1024) throw new Error("Original document uploads must total at most 2 MB.");
      if (!document.content_type || !document.filename) throw new Error("Original files need a filename and content_type.");
      if (document.content_type === "application/pdf" && bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("The uploaded PDF is invalid.");
      digest = hash(bytes); fileKey = `${hash(input.idempotency_key)}-${document.kind}-${digest}`;
      await storeFile("submission-files", fileKey, bytes);
    }
    docs.push({ kind: document.kind, text: document.text, filename: document.filename, content_type: document.content_type, ...(fileKey ? { file_key: fileKey } : {}), sha256: digest });
  }
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${deterministicId}, 0))::text`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))::text`;
    let existing = input.id ? await tx.application.findUnique({ where: { id: input.id } }) :
      await tx.application.findFirst({ where: { OR: [{ id: deterministicId }, ...(postingUrl ? [{ postingUrl, company: { equals: input.company, mode: "insensitive" as const }, role: { equals: input.role, mode: "insensitive" as const } }] : [])] } });
    if (!existing && !input.id && postingUrl) {
      const candidates = await tx.application.findMany({ where: { company: { equals: input.company, mode: "insensitive" }, role: { equals: input.role, mode: "insensitive" } } });
      existing = candidates.find(candidate => { try { return Boolean(candidate.postingUrl && canonicalPostingUrl(candidate.postingUrl) === postingUrl); } catch { return false; } }) ?? null;
    }
    if (input.id && !existing) throw new Error("That application no longer exists.");
    const previous = (existing?.submission && typeof existing.submission === "object" && !Array.isArray(existing.submission) ? existing.submission : {}) as Partial<SubmissionInfo>;
    if (previous.confirmed && !input.confirmed) throw new Error("An unconfirmed attempt cannot replace a confirmed submission record.");
    const submission: SubmissionInfo = { ...previous, source: input.source, confirmed: input.confirmed || previous.confirmed === true,
      ...(input.bot === undefined ? {} : { bot: input.bot }), ...(input.submitted_at ? { submitted_at: input.submitted_at } : {}),
      ...(input.confirmation_reference === undefined ? {} : { confirmation_reference: input.confirmation_reference }), ...(input.confirmation_url ? { confirmation_url: input.confirmation_url } : {}),
      ...(input.recruiter ? { recruiter: input.recruiter } : {}), ...(input.documents ? { documents: docs } : {}),
    };
    const details = { company: input.company, role: input.role, ...(input.posting_text === undefined ? {} : { postingText: input.posting_text }), ...(postingUrl ? { postingUrl } : {}),
      ...(input.location === undefined ? {} : { location: input.location }), ...(input.mode === undefined ? {} : { mode: input.mode }), ...(input.salary === undefined ? {} : { salary: input.salary }),
      ...(input.deadline === undefined ? {} : { deadline: input.deadline ? new Date(input.deadline) : null }), submission: submission as unknown as Prisma.InputJsonValue };
    const row = existing ? await tx.application.update({ where: { id: existing.id }, data: details }) : await tx.application.create({ data: { id: deterministicId, title: `${input.role} · ${input.company}`, ...details } });
    if (input.confirmed && row.status === "DRAFT") {
      const change = advance(row, "SENT", new Date(input.submitted_at!));
      if (change) await tx.application.update({ where: { id: row.id }, data: { ...change.update, events: { create: change.event } } });
    }
    // The same payload retried must not append the same note repeatedly.
    if (input.note && !(await tx.note.findFirst({ where: { applicationId: row.id, body: input.note } }))) await tx.note.create({ data: { applicationId: row.id, body: input.note } });
    return { id: row.id, created: !existing, confirmed: submission.confirmed, documents: submission.documents?.map(doc => ({ kind: doc.kind, filename: doc.filename, sha256: doc.sha256, content_type: doc.content_type })) ?? [] };
  });
  return result;
}
