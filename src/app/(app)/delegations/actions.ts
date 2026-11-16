"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { prisma } from "@/lib/prisma";
import { audit, permissionNames } from "@/lib/connector/delegation";
import { connectorSince } from "@/lib/connector/oauth";
import { resolveApproval } from "@/lib/connector/approvals";

const form = z.instanceof(FormData);
const problem = (message: string): never => redirect(`/delegations?problem=${encodeURIComponent(message)}`);

/** The permission form's own submit; saving revokes any pending review for the app. */
export const saveGrant = formAction(form, async (data) => {
  const id = z.string().regex(/^[a-f0-9]{64}$/).safeParse(data.get("id"));
  const permissions = z.array(z.enum(permissionNames)).safeParse(data.getAll("permissions"));
  if (!id.success || !permissions.success) return problem("Choose permissions from the list and try again.");
  const grant = await prisma.connectorGrant.findUnique({ where: { id: id.data } });
  if (!grant || grant.generation !== await connectorSince()) return problem("This connection changed. Reconnect and request access again.");
  await prisma.connectorGrant.update({ where: { id: id.data }, data: { permissions: permissions.data, approvedAt: new Date() } });
  // Revoking any access invalidates outstanding action requests for that client.
  await prisma.connectorApproval.updateMany({ where: { clientId: id.data, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "REJECTED" } });
  await audit(id.data, "permissions_changed", undefined, permissions.data.length ? "granted" : "revoked");
  revalidatePath("/delegations");
}, "/delegations");

/** The review page's own submit. A handled or expired review sends the reason back. */
export const decideApproval = formAction(form, async (data) => {
  const id = z.string().min(1).max(100).safeParse(data.get("id"));
  if (!id.success) redirect("/delegations");
  const approve = data.get("decision") === "approve";
  let problem: string | null = null;
  try { await resolveApproval(id.data, approve); }
  catch (e) {
    const message = e instanceof Error ? e.message : "";
    const safe = ["This review expired or was already handled.", "This review was already handled.", "Permissions changed. Request a new review.", "The application changed. Request a new review.", "The action needs manual verification. Check its status before requesting it again."];
    problem = safe.includes(message) ? message : "The action could not be completed. Review its status before trying again.";
  }
  revalidatePath("/", "layout");
  redirect(`/delegations/approvals/${encodeURIComponent(id.data)}${problem ? `?problem=${encodeURIComponent(problem)}` : ""}`);
}, "/delegations");
