import Link from "next/link";
import { verifySession } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/connector/delegation";
import { connectorSince } from "@/lib/connector/oauth";
import { prisma } from "@/lib/prisma";
import { saveGrant } from "./actions";
export const metadata = { title: "MCP permissions and approvals" };
export default async function DelegationsPage({ searchParams }: { searchParams: Promise<{ problem?: string }> }) {
  await verifySession();
  const { problem } = await searchParams;
  const generation = await connectorSince();
  const [grants, approvals, audits] = await Promise.all([
    prisma.connectorGrant.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.connectorApproval.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.connectorAudit.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
    <Link href="/settings?section=connector" className="underline">Back to MCP connector settings</Link>
    <h1 className="font-serif text-3xl">MCP permissions and approvals</h1>
    <p>Choose what each connected app may do. HireMe’s stored API keys, passwords, encryption secrets and security settings are never available through these permissions. Email, permanent deletion and final submission handoffs require a separate review for each action.</p>
    {problem && <p role="alert" className="rounded-lg border border-red-700 bg-red-50 p-3 text-sm text-red-900">{problem}</p>}
    {!grants.length && <p>No app has requested extended access yet. Refresh the tools in your MCP client, then ask it to request the permissions you want.</p>}
    {grants.map(grant => {
      const current = Boolean(generation && grant.generation === generation);
      const allowed = current && Array.isArray(grant.permissions) ? grant.permissions : [];
      const requested = Array.isArray(grant.requested) ? grant.requested : [];
      return <section key={grant.id} className="rounded-lg border border-line p-5">
        <h2 className="text-xl font-medium">{grant.name}</h2>
        <p className="text-sm">Connection {grant.id.slice(0, 12)} · {current ? grant.approvedAt ? "Permissions saved" : "Waiting for your review" : "Connection changed; request access again"}</p>
        <form action={saveGrant} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="id" value={grant.id}/>
          {Object.entries(PERMISSIONS).map(([key, label]) => <label key={key} className="flex items-start gap-3">
            <input type="checkbox" name="permissions" value={key} disabled={!current} defaultChecked={allowed.includes(key)} className="mt-1"/>
            <span>{label}{requested.includes(key) && !allowed.includes(key) ? " (requested)" : ""}</span>
          </label>)}
          <button type="submit" disabled={!current} className="mt-2 rounded bg-primary px-4 py-2 text-on-primary hover:bg-primary-hover disabled:opacity-50">Save these permissions</button>
          <p className="text-sm">Uncheck a permission to revoke it. Uncheck all to disable this app’s data access and actions. Saving changes invalidates its pending approvals.</p>
        </form>
      </section>;
    })}
    <section><h2 className="mb-3 text-xl font-medium">Action reviews</h2>
      {!approvals.length && <p>No action reviews yet.</p>}
      <ul className="flex flex-col gap-2">{approvals.map(row => <li key={row.id}><Link className="underline" href={`/delegations/approvals/${row.id}`}>{row.action === "email" ? "Send email" : row.action === "delete" ? "Delete application" : "External submission handoff"} · {row.status === "PENDING" && row.expiresAt < new Date() ? "EXPIRED" : row.status} · {row.createdAt.toISOString()}</Link></li>)}</ul>
    </section>
    <section><h2 className="mb-3 text-xl font-medium">Recent delegated activity</h2><ul>{audits.map(row => <li key={row.id} className="py-1 text-sm">{row.createdAt.toISOString()} · {row.action} · {row.outcome} · app {row.clientId.slice(0, 12)}</li>)}</ul></section>
  </main>;
}
