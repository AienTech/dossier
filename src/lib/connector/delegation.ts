import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { connectorSince, readClient } from "./oauth";

export const PERMISSIONS = {
  profile_read: "Read professional profile (without contact details)",
  applications_read: "Read applications, documents, status history and dashboard",
  job_search: "Search jobs, read saved searches, score, save and dismiss postings",
  ai_draft: "Ask HireMe’s AI to draft applications and inspect those drafts",
  private_read: "Read contact details, private notes and submitted documents",
  profile_edit: "Edit profile fields and entries",
  settings_edit: "Edit document, AI model and job-agent preferences (no secrets or security settings)",
  jobs_manage: "Inspect, retry and cancel background tasks; run bounded job searches",
  applications_edit: "Import complete manual/bot applications and edit their documents and notes",
  email_request: "Prepare email for approval; cannot send without owner approval",
  delete_request: "Request permanent application deletion for owner approval",
  submit_request: "Prepare an external submission handoff for owner approval",
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const permissionNames = Object.keys(PERMISSIONS) as [Permission, ...Permission[]];
export const clientKey = (id: string) => createHash("sha256").update(id).digest("hex");
export async function requestDelegation(clientId: string, permissions: Permission[]) {
  if (!clientId) throw new Error("Reconnect the MCP client first.");
  const generation = await connectorSince();
  if (!generation) throw new Error("The connector is disabled.");
  const id = clientKey(clientId);
  const client = await readClient(clientId);
  if (!client) throw new Error("Reconnect the MCP client first.");
  const before = await prisma.connectorGrant.findUnique({ where: { id } });
  const current = before?.generation === generation ? before : null;
  const requested = [...new Set(permissions)];
  await prisma.connectorGrant.upsert({ where: { id }, create: { id, name: client.name, generation, requested, permissions: BASELINE_PERMISSIONS }, update: {
    name: client.name, generation, requested, ...(current ? {} : { permissions: before?.permissions ?? BASELINE_PERMISSIONS, approvedAt: null }),
  } });
  return { client_id: id, requested, granted: current?.permissions ?? [], review_path: "/delegations" };
}
export async function requirePermission(clientId: string, permission: Permission): Promise<string> {
  const id = clientKey(clientId);
  const [grant, generation] = await Promise.all([prisma.connectorGrant.findUnique({ where: { id } }), connectorSince()]);
  if (!clientId || !generation || grant?.generation !== generation || !grant.approvedAt || !Array.isArray(grant.permissions) || !grant.permissions.includes(permission)) {
    throw new Error(`Permission ${permission} has not been granted to this app. Request delegation and ask the owner to review /delegations.`);
  }
  return id;
}
export async function audit(clientId: string, action: string, target?: string, outcome = "done") {
  await prisma.connectorAudit.create({ data: { clientId, action, target, outcome } });
}

/** These are the pre-existing OAuth capabilities; all new access is opt-in. */
export const BASELINE_PERMISSIONS: Permission[] = ["profile_read", "applications_read", "job_search", "ai_draft", "applications_edit"];
export const LEGACY_PERMISSIONS: Record<string, Permission> = {
  get_profile: "profile_read", get_application: "applications_read", list_applications: "applications_read", get_dashboard: "applications_read", get_application_history: "applications_read",
  search_jobs: "job_search", more_jobs: "job_search", list_jobs: "job_search", list_job_searches: "job_search", get_posting: "job_search", save_job_scores: "job_search", set_job_state: "job_search",
  draft_application: "ai_draft", check_draft: "ai_draft", save_application: "applications_edit", track_application: "applications_edit", update_application: "applications_edit", set_application_status: "applications_edit", set_application_archived: "applications_edit", add_application_note: "applications_edit",
};
export async function legacyAllowed(clientId: string, name: string) {
  const permission = LEGACY_PERMISSIONS[name]; if (!permission) return true;
  const id = clientKey(clientId); const generation = await connectorSince(); if (!generation) return false;
  let grant = await prisma.connectorGrant.findUnique({ where: { id } });
  if (!grant) {
    const client = await readClient(clientId); if (!client) return false;
    // Upsert rather than createMany(skipDuplicates): SQLite has no skipDuplicates.
    // Concurrent first calls can still race on create and throw P2002; treat that as done.
    try {
      await prisma.connectorGrant.upsert({ where: { id }, create: { id, name: client.name, generation, permissions: BASELINE_PERMISSIONS, requested: [] }, update: {} });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
    grant = await prisma.connectorGrant.findUnique({ where: { id } });
  }
  return grant?.generation === generation && Array.isArray(grant.permissions) && grant.permissions.includes(permission);
}
/** Run before dispatch so existing tools honor the same per-app switches. */
export async function checkLegacyCall(request: Request, clientId: string): Promise<Response | null> {
  if (request.method !== "POST") return null;
  let message: unknown;
  try { message = await request.clone().json(); } catch { return null; }
  if (Array.isArray(message)) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch requests are not supported." } }, { status: 400 });
  if (!message || typeof message !== "object") return null;
  const call = message as { id?: string | number; method?: string; params?: { name?: string } };
  if (call.method !== "tools/call" || typeof call.params?.name !== "string" || !LEGACY_PERMISSIONS[call.params.name]) return null;
  if (await legacyAllowed(clientId, call.params.name)) return null;
  return Response.json({ jsonrpc: "2.0", id: call.id ?? null, result: { content: [{ type: "text", text: "This app’s permission for that function is disabled. The owner can change it in Settings → MCP connector → Manage app permissions." }], isError: true } });
}
