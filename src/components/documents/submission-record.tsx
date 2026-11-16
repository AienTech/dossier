import { submissionSnapshot } from "@/lib/submission-data";
/** Actual submitted material stays separate from later AI drafts. */
export function SubmissionRecord({ id, value }: { id: string; value: unknown }) {
  const parsed = submissionSnapshot.safeParse(value); if (!parsed.success) return null;
  const submission = parsed.data;
  return <section className="mx-8 my-5 rounded-lg border border-line p-5">
    <h2 className="text-xl font-medium">Actual submission record</h2>
    <p>{submission.source === "bot" ? `Applied through ${submission.bot || "a bot"}` : "Manual application"} · {submission.confirmed ? `Confirmed ${submission.submitted_at ?? ""}` : "Not confirmed as submitted"}</p>
    {submission.confirmation_reference && <p>Confirmation: {submission.confirmation_reference}</p>}
    {submission.confirmation_url && <a className="underline" href={submission.confirmation_url} target="_blank" rel="noreferrer">Open confirmation</a>}
    {submission.recruiter && <p>Recruiter: {[submission.recruiter.name, submission.recruiter.email, submission.recruiter.phone].filter(Boolean).join(" · ")}</p>}
    {submission.documents?.map(doc => <details className="my-3 rounded border border-line p-3" key={doc.kind}>
      <summary>Submitted {doc.kind.replaceAll("_", " ")}{doc.filename ? ` · ${doc.filename}` : ""}</summary>
      <p className="my-2 text-sm">This is the material recorded as submitted, separate from any later drafts.</p>
      {doc.file_key && <a className="underline" href={`/api/submission-files/${id}/${doc.file_key}`}>Download original file</a>}
      <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm">{doc.text}</pre>
    </details>)}
  </section>;
}
