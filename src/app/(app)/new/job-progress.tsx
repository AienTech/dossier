"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressSteps } from "@/components/ui/progress-steps";
import type { JobView } from "@/lib/jobs/runner";

/** The step a job is on: its own last-named step, or past the end once it's done. */
export function jobStep(steps: readonly string[], job: Pick<JobView, "status" | "step"> | null): number {
  if (job?.status === "DONE") return steps.length;
  return Math.max(0, steps.indexOf(job?.step ?? ""));
}

/**
 * Named steps of the work in progress (NEW-2, NEW-7), advanced by the job
 * itself, with its plain-language error, Retry and a way back when it fails.
 */
export function JobProgress({
  title,
  waiting,
  steps,
  current,
  error,
  onRetry,
  onBack,
  backLabel = "← Back to the posting",
}: {
  title: string;
  waiting?: string | null;
  steps: readonly string[];
  current: number;
  /** Why it stopped, if it did. */
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
  backLabel?: string;
}) {
  return (
    <Card className="flex flex-col gap-[22px] px-9 py-10">
      {/* Takes focus when its step starts (E11-3). */}
      <h2 tabIndex={-1} className="font-serif text-section">
        {waiting ? "Waiting for the cloud worker…" : title}
      </h2>
      {waiting ? <p role="status" className="text-control text-muted">{waiting} A cold start can take a minute or two. Your job is saved.</p> : <ProgressSteps steps={steps} current={current} />}
      {error ? (
        <div role="alert" className="flex flex-col gap-3.5">
          <p className="text-control text-error">{error}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={onRetry}>Retry</Button>
            <Button variant="text" onClick={onBack}>
              {backLabel}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-meta text-muted">The page will update as each step finishes.</p>
      )}
    </Card>
  );
}
