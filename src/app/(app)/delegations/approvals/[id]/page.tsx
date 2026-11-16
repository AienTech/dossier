import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { decideApproval } from "../../actions";
export const metadata = { title: "Review delegated action" };
export default async function ApprovalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ problem?: string }> }) {
  await verifySession();
  const { id } = await params; const { problem } = await searchParams;
  const row = await prisma.connectorApproval.findUnique({ where: { id } }); if (!row) notFound();
  const client = await prisma.connectorGrant.findUnique({ where: { id: row.clientId } });
  const payload = row.payload as Record<string, unknown>;
  const files = (payload.files ?? []) as { key: string; filename: string; bytes: number; sha256: string }[];

  const pending = row.status === "PENDING" && row.expiresAt > new Date();
  return <main className="mx-auto flex max-w-4xl flex-col gap-5 p-8">
    <Link className="underline" href="/delegations">Back to permissions and approvals</Link>
    <h1 className="font-serif text-3xl">{row.action === "email" ? "Review email before sending" : row.action === "delete" ? "Review permanent deletion" : "Review external submission handoff"}</h1>
    <p>Requested by {client?.name ?? "MCP app"}. Status: {row.status}. Expires {row.expiresAt.toISOString()}.</p>
    {problem && <p role="alert" className="rounded border border-red-500 p-3">{problem}</p>}
    {row.action === "delete" && <p>The application, its documents, notes, conversation and status history will be permanently deleted. HireMe writes a backup first.</p>}
    {row.action === "submit" && <p>This approves the exact URL and answers below for a browser agent. HireMe does not visit or submit the external website itself. The agent must verify this approval and stop if the form or documents change.</p>}
    <section className="rounded border border-line p-4">
      <h2 className="text-xl">{String(payload.company)} · {String(payload.role)}</h2>
      {row.action === "email" && <><p className="mt-3">From: {String(payload.from)}</p><p>To: {String(payload.to)}</p><p>Subject: {String(payload.subject)}</p><pre className="mt-4 whitespace-pre-wrap break-words font-sans">{String(payload.body)}</pre></>}
      {row.action === "delete" && <p className="mt-3">Includes {String((payload.deletes as Record<string, unknown>)?.documents ?? 0)} documents, {String((payload.deletes as Record<string, unknown>)?.notes ?? 0)} notes and {String((payload.deletes as Record<string, unknown>)?.messages ?? 0)} conversation messages, plus its status history and tasks.</p>}
      {row.action === "submit" && <><p className="mt-3">Destination: {String(payload.target_url)}</p><dl className="mt-3">{Object.entries((payload.answers ?? {}) as Record<string, string>).map(([label, value]) => <div key={label} className="my-3"><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}</dl></>}
    </section>
    {files.length > 0 && <section><h2 className="text-xl">Exact attachments</h2><ul>{files.map(file => <li key={file.key}><a className="underline" href={`/api/delegation-files/${row.id}/${file.key}`}>{file.filename}</a> · {file.bytes.toLocaleString()} bytes · SHA-256 {file.sha256}</li>)}</ul></section>}
    {pending ? <form action={decideApproval} className="flex gap-3"><input type="hidden" name="id" value={row.id}/><button name="decision" value="reject" className="rounded border border-line px-4 py-2">Reject</button><button name="decision" value="approve" className="rounded bg-primary px-4 py-2 text-on-primary hover:bg-primary-hover disabled:opacity-50">{row.action === "email" ? "Approve and send this email" : row.action === "delete" ? "Approve permanent deletion" : "Approve this submission handoff"}</button></form> : <p>This review cannot be approved again. {row.status === "NEEDS_REVIEW" ? "Check Gmail and HireMe before requesting another action; the email may already have been sent." : ""}</p>}
    {row.result && <pre className="whitespace-pre-wrap break-words rounded border border-line p-4 text-sm">{JSON.stringify(row.result, null, 2)}</pre>}
  </main>;
}
