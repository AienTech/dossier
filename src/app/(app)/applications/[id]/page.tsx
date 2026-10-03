import type { Metadata } from "next";

import { activityTimeline } from "@/lib/activity";
import { isAiConfigured } from "@/lib/ai/config";
import { editsSchema, matchSchema, matchScore } from "@/lib/application-data";
import { loadApplication, loadDocuments, readJson } from "@/lib/application-documents";
import { formatShortDate } from "@/lib/dates";
import { refineJobKey } from "@/lib/jobs/refine";
import { regenerateUnitJob, unitJobKey } from "@/lib/jobs/regenerate-unit";
import { findUnfinishedJobs } from "@/lib/jobs/runner";
import { refineSuggestions } from "@/lib/refine-suggestions";
import { userTimeZone } from "@/lib/time-zone";

import { ApplicationView } from "./application-view";
import { metaLine } from "./meta";
import { tabFrom } from "./tabs";

export async function generateMetadata({ params }: PageProps<"/applications/[id]">): Promise<Metadata> {
  const { id } = await params;
  const application = await loadApplication(id);
  return { title: application.title.trim() || "Untitled application" };
}

/** One application (PRD §6.5): its status, tailored documents, posting and notes. */
export default async function ApplicationPage({ params, searchParams }: PageProps<"/applications/[id]">) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const [{ application, profile, settings, extracted, resume, letter, includeReferences, letterDate }, aiReady, unitJobs, refineJobs, timeZone] =
    await Promise.all([
      loadDocuments(id),
      isAiConfigured(),
      findUnfinishedJobs(unitJobKey(id)),
      findUnfinishedJobs(refineJobKey(id)),
      userTimeZone(),
    ]);

  const match = readJson(matchSchema, application.match);
  const messages = application.messages
    .map((message, index) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      targetUnit: message.targetUnit,
      // Written in code when the application was created (E7-6).
      opening: index === 0 && message.role === "AI" && !message.writtenWith,
      canUndo: message.role === "AI" && (readJson(editsSchema, message.edits)?.length ?? 0) > 0,
      undone: message.undone,
    }))
    // Settings → "Show what changed" off hides the list of what was tailored (SET-5).
    .filter((message) => settings.showDiff || !message.opening);
  const { title, company, location, status, tone, language, followThemeLayout, nextInterviewAt } = application;
  // Units still being rewritten, so a reload keeps showing it.
  const rewriting = unitJobs.flatMap((job) => {
    const input = regenerateUnitJob.input.safeParse(job.input);
    return input.success ? [{ jobId: job.id, document: input.data.document, unitId: input.data.unitId }] : [];
  });

  return (
    <ApplicationView
      application={{
        id,
        title,
        company,
        location,
        status,
        tone,
        language,
        followThemeLayout,
        archived: application.archivedAt !== null,
        nextInterviewAt,
      }}
      timeZone={timeZone}
      posting={{
        text: application.postingText,
        // New applications only keep web links, but an imported file could carry any URL (E11-5).
        url: /^https?:\/\//i.test(application.postingUrl) ? application.postingUrl : "",
        pasted: formatShortDate(application.createdAt),
      }}
      match={match}
      requirements={extracted?.requirements ?? []}
      activity={activityTimeline({ notes: application.notes, events: application.events, createdAt: application.createdAt })}
      meta={metaLine(application)}
      resume={resume}
      letter={letter}
      profile={profile}
      paper={settings.paper}
      dateFormat={settings.dateFormat}
      includeReferences={includeReferences}
      letterDate={letterDate}
      score={match && match.items.length > 0 ? matchScore(match) : null}
      initialTab={tabFrom(tab)}
      aiReady={aiReady}
      rewriting={rewriting}
      messages={messages}
      refining={refineJobs.at(-1)?.id ?? null}
      suggestions={refineSuggestions({
        match,
        requirements: extracted?.requirements ?? [],
        tone,
        hasSummary: Boolean(resume?.units.some((unit) => unit.id === "summary" && unit.text.trim())),
      })}
    />
  );
}
