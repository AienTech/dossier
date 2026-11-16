"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkInbox } from "@/lib/google/actions";
import { useJob } from "@/hooks/use-job";
import type { InboxCheckResult } from "@/lib/jobs/check-inbox";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
export function CheckInboxButton() {
  const router = useRouter(); const [starting, start] = useTransition(); const [id, setId] = useState<string | null>(null);
  const job = useJob<InboxCheckResult>(id, 0, value => {
    if (value.status === "DONE" && value.result) {
      toast(`Checked job mail: ${value.result.kept} matched emails, ${value.result.updated} board updates, ${value.result.reviewNeeded} need review.`); setId(null); router.refresh();
    } else if (value.status === "FAILED") { toast(value.error || "The email check failed."); setId(null); router.refresh(); }
  });
  const run = () => start(async () => { const result = toastResult(await checkInbox({})); if (result.ok && result.data?.jobId) setId(result.data.jobId); router.refresh(); });
  return <div className="flex flex-col items-start gap-2"><Button variant="secondary" onClick={run} disabled={starting || Boolean(id)}>{starting || id ? "Checking…" : "Check now"}</Button>{id && <p role="status" className="text-meta text-muted">{job?.step || "Starting the worker for one job-mail check…"}</p>}</div>;
}
