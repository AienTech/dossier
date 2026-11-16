import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, resetDatabase } from "@/test/db";
const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => { const { createTestClient } = await import("@/test/db"); db.client = createTestClient(); return { prisma: db.client }; });
vi.mock("./oauth", () => ({ connectorSince: vi.fn(async () => "generation-1"), readClient: vi.fn(async () => ({ name: "Test MCP app", redirectUris: [] })) }));
vi.mock("@/lib/env", () => ({ env: { HIREME_SECRET: "x".repeat(40), HIREME_DATA_DIR: "/tmp/hireme-delegation-test", HIREME_BACKUP_RETENTION_DAYS: 14 } }));
vi.mock("@/lib/pdf/render", () => ({ renderPdf: vi.fn(async () => new TextEncoder().encode("%PDF-frozen-test")) }));
vi.mock("@/lib/google/account", () => ({ loadGoogleAccount: vi.fn(async () => ({ email: "owner@example.com" })) }));
vi.mock("@/lib/google/gmail", () => ({ sendMail: vi.fn(async () => ({ id: "gmail-approved-1", threadId: "thread-1" })) }));
vi.mock("@/lib/backups", () => ({ writeBackup: vi.fn(async () => "before-delete.json") }));
vi.mock("@/lib/jobs/runner", () => ({ cancelApplicationJobs: vi.fn() }));
import { BASELINE_PERMISSIONS, checkLegacyCall, clientKey, legacyAllowed, requestDelegation, requirePermission } from "./delegation";
import { recordExternalApplication, recordSubmission } from "./submission";
import { approvedSubmissionPacket, createApproval, finishSubmission, readApproval, resolveApproval } from "./approvals";
import { sendMail } from "@/lib/google/gmail";
const prisma = () => db.client!;
const client = "signed-client-A"; const key = clientKey(client);
async function grant(permissions: string[]) { await prisma().connectorGrant.upsert({ where: { id: key }, create: { id: key, name: "Test app", generation: "generation-1", permissions, requested: [], approvedAt: new Date() }, update: { permissions, approvedAt: new Date() } }); }
const external = { idempotency_key: "manual-1", company: "Example", role: "Engineer", posting_url: "https://example.com/job/1?utm_source=test", source: "manual" as const, confirmed: true, submitted_at: "2026-11-12T08:00:00Z", note: "Actually submitted by me", documents: [{ kind: "resume" as const, text: "The exact resume submitted." }] };
beforeEach(async () => { await resetDatabase(prisma()); vi.mocked(sendMail).mockClear(); });
afterAll(async () => prisma().$disconnect());
describe("MCP delegation security", () => {
  it("cannot grant itself new private access and honors per-app revocation", async () => {
    await requestDelegation(client, ["private_read"]);
    await expect(requirePermission(client, "private_read")).rejects.toThrow("has not been granted");
    expect(await legacyAllowed(client, "get_profile")).toBe(true);
    await grant(["private_read"]);
    expect(await requirePermission(client, "private_read")).toBe(key);
    expect(await legacyAllowed(client, "get_profile")).toBe(false);
    await expect(requirePermission("other-client", "private_read")).rejects.toThrow();
    const response = await checkLegacyCall(new Request("https://hireme.example/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_profile" } }) }), client);
    expect((await response!.json()).result.isError).toBe(true);
  });
  it("preserves baseline permissions without silently enabling extended tools", async () => {
    expect(await legacyAllowed(client, "list_applications")).toBe(true);
    expect((await prisma().connectorGrant.findUniqueOrThrow({ where: { id: key } })).permissions).toEqual(BASELINE_PERMISSIONS);
    await expect(requirePermission(client, "email_request")).rejects.toThrow();
  });
});
describe("complete external application records", () => {
  it("records actual documents, dates and one status transition idempotently", async () => {
    const first = await recordExternalApplication(external);
    const second = await recordExternalApplication(external);
    expect(second.id).toBe(first.id); expect(second.created).toBe(false);
    const row = await prisma().application.findUniqueOrThrow({ where: { id: first.id }, include: { events: true, notes: true } });
    expect(row.status).toBe("SENT"); expect(row.sentAt).toEqual(new Date(external.submitted_at));
    expect(row.events).toHaveLength(1); expect(row.notes).toHaveLength(1);
    expect(row.submission).toMatchObject({ confirmed: true, documents: [{ text: external.documents[0].text }] });
    expect(await prisma().document.count()).toBe(0); // Does not invent a new AI-written resume.
  });
  it("deduplicates normalized posting URLs and keeps unconfirmed attempts as drafts", async () => {
    const first = await recordExternalApplication({ ...external, confirmed: false, submitted_at: undefined });
    const second = await recordExternalApplication({ ...external, idempotency_key: "different-bot-key", posting_url: "https://example.com/job/1", confirmed: false, submitted_at: undefined });
    expect(second.id).toBe(first.id);
    expect((await prisma().application.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("DRAFT");
    expect(recordSubmission.safeParse({ ...external, submitted_at: undefined }).success).toBe(false);
  });
});
describe("owner approval gates", () => {
  async function app() { return prisma().application.create({ data: { company: "Example", role: "Engineer" } }); }
  it("freezes the exact email and rejects replay or client substitution", async () => {
    await grant(["email_request"]); const a = await app();
    const request = await createApproval(key, "email", { application_id: a.id, to: "recruiter@example.com", subject: "Approved subject", body: "Exact approved text", attach_documents: false }, "https://hireme.example");
    expect(sendMail).not.toHaveBeenCalled();
    await expect(readApproval(clientKey("other-client"), request.approval_id)).rejects.toThrow();
    await resolveApproval(request.approval_id, true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "recruiter@example.com", subject: "Approved subject", body: "Exact approved text" }));
    await expect(resolveApproval(request.approval_id, true)).rejects.toThrow();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
  it("keeps approved submission packets valid during background Drive bookkeeping", async () => {
    await grant(["submit_request"]); const a = await app();
    const request = await createApproval(key, "submit", { application_id: a.id, target_url: "https://example.com/apply", answers: { name: "Jane" } }, "https://hireme.example");
    await prisma().application.update({ where: { id: a.id }, data: { driveSync: { jobId: "background-job" }, updatedAt: a.updatedAt } });
    await resolveApproval(request.approval_id, true);
    await prisma().application.update({ where: { id: a.id }, data: { driveSync: { url: "https://drive.google.com/drive/folders/archive", sourceHash: "new-snapshot" }, updatedAt: a.updatedAt } });
    expect(await readApproval(key, request.approval_id)).toHaveProperty("approved_payload");
    await prisma().note.create({ data: { applicationId: a.id, body: "Answers changed" } });
    expect(await readApproval(key, request.approval_id)).not.toHaveProperty("approved_payload");
  });
  it("rejects changed notes/documents, revoked permissions and expired reviews", async () => {
    await grant(["delete_request"]); const a = await app();
    const request = await createApproval(key, "delete", { application_id: a.id }, "https://hireme.example");
    await prisma().note.create({ data: { applicationId: a.id, body: "A new note after the review was prepared" } });
    await expect(resolveApproval(request.approval_id, true)).rejects.toThrow("changed");
    expect(await prisma().application.count()).toBe(1);
    const fresh = await createApproval(key, "delete", { application_id: a.id }, "https://hireme.example");
    await grant([]); await expect(resolveApproval(fresh.approval_id, true)).rejects.toThrow("Permissions changed");
    await grant(["delete_request"]); await prisma().connectorApproval.update({ where: { id: fresh.approval_id }, data: { expiresAt: new Date(0) } });
    await expect(resolveApproval(fresh.approval_id, true)).rejects.toThrow("expired");
  });
  it("deletes only after owner approval and preserves the audit trail", async () => {
    await grant(["delete_request"]); const a = await app();
    const request = await createApproval(key, "delete", { application_id: a.id }, "https://hireme.example");
    expect(await prisma().application.count()).toBe(1);
    await resolveApproval(request.approval_id, true);
    expect(await prisma().application.count()).toBe(0);
    expect((await prisma().connectorApproval.findUniqueOrThrow({ where: { id: request.approval_id } })).status).toBe("DONE");
    expect(await prisma().connectorAudit.count({ where: { action: "delete", outcome: "done" } })).toBe(1);
  });
  it("does not replay an email with an uncertain provider result", async () => {
    await grant(["email_request"]); const a = await app();
    const request = await createApproval(key, "email", { application_id: a.id, to: "r@example.com", subject: "Hello", body: "Body" }, "https://hireme.example");
    vi.mocked(sendMail).mockRejectedValueOnce(new Error("Connection lost after provider may have accepted"));
    await expect(resolveApproval(request.approval_id, true)).rejects.toThrow("manual verification");
    await expect(resolveApproval(request.approval_id, true)).rejects.toThrow("already handled");
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect((await prisma().connectorApproval.findUniqueOrThrow({ where: { id: request.approval_id } })).status).toBe("NEEDS_REVIEW");
  });
  it("requires an approved immutable handoff; failed browser submissions never become Sent", async () => {
    await grant(["submit_request"]); const a = await app();
    const request = await createApproval(key, "submit", { application_id: a.id, target_url: "https://employer.example/apply", answers: { eligibility: "Remote from Portugal" } }, "https://hireme.example");
    await expect(approvedSubmissionPacket(key, request.approval_id)).rejects.toThrow();
    await resolveApproval(request.approval_id, true);
    const packet = await approvedSubmissionPacket(key, request.approval_id);
    expect(packet.payload.target_url).toBe("https://employer.example/apply");
    await finishSubmission(key, request.approval_id, { confirmed: false, failure: "Site did not confirm submission" });
    expect((await prisma().application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("DRAFT");
    expect(sendMail).not.toHaveBeenCalled();
  });
});
