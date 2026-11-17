import "server-only";

import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { applyStatusChange } from "@/lib/status-changes";

import { ApplicationStatus, DocumentKind, EmailDirection } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { isAiConfigured } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { classifyReply } from "@/lib/ai/tasks";
import { unitsSchema } from "@/lib/application-data";
import { emailParts } from "@/lib/application-email";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { googleConnection, loadGoogleAccount } from "./account";
import { pullInterviewEvents } from "./availability";
import { GoogleError, isPassing } from "./errors";
import { currentHistoryId, getMessage, messagesSince, searchMessages, type ReadMail } from "./gmail";
import { baseDomain, companyDomains, matchMail, worthSuggesting, type MatchableApplication } from "./matching";
import { domainOf, parseAddress, stripQuoted } from "./mime";

// The inbox check (E15-3): new mail since the last check, matched to
// applications, kept, and read by the AI. A plain timer in this process,
// like the nightly backups, so it's only safe with a single instance.

/** Mail is kept up to this length. */
const MAX_BODY = 20_000;
/** The first check looks this far back. */
const FIRST_LOOK = "newer_than:21d";
/** Gmail's tabs for mail that's never about an application, and drafts, which weren't sent. */
const NOISE_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS", "SPAM", "TRASH", "CHAT", "DRAFT"];

export const questionsSchema = z.array(z.string());

async function matchables(): Promise<MatchableApplication[]> {
  // Agent drafts waiting for review were never sent: no reply can be about them (#195).
  const applications = await prisma.application.findMany({
    where: { archivedAt: null, awaitingReview: false },
    select: {
      id: true,
      company: true,
      status: true,
      postingText: true,
      updatedAt: true,
      documents: { where: { kind: DocumentKind.EMAIL }, select: { units: true } },
    },
  });
  return applications.map(({ documents, ...application }) => {
    const units = unitsSchema.safeParse(documents[0]?.units);
    return { ...application, emailTo: units.success ? emailParts(units.data).to : "" };
  });
}

async function knownThreads(): Promise<Map<string, string>> {
  const [linked, sent] = await Promise.all([
    prisma.emailMessage.findMany({ where: { applicationId: { not: null } }, select: { threadId: true, applicationId: true }, distinct: ["threadId"] }),
    prisma.application.findMany({ where: { emailThreadId: { not: null } }, select: { id: true, emailThreadId: true } }),
  ]);
  return new Map([
    ...linked.map((entry) => [entry.threadId, entry.applicationId!] as const),
    ...sent.map((entry) => [entry.emailThreadId!, entry.id] as const),
  ]);
}

export type SyncResult = {
  fetched: number;
  kept: number;
  read: number;
  /** Messages Google wouldn't give this time; the next check tries them again (public issue 68). */
  unread: number;
  /** Only with `applyUpdates`: status suggestions applied, and ones left for review. */
  updated?: number;
  reviewNeeded?: number;
};
type SyncOptions = { signal?: AbortSignal; jobOnly?: boolean; lookbackDays?: number; applyUpdates?: boolean; progress?: (step: string) => Promise<void> };
export function jobMailQuery(applications: readonly MatchableApplication[], days: number): string {
  const companies = [...new Set(applications.map(app => app.company.replace(/[^\p{L}\p{N} -]/gu, " ").trim()).filter(name => name.length >= 4))].slice(0, 100).map(name => `"${name.slice(0, 60)}"`);
  return `newer_than:${Math.min(90, Math.max(1, days))}d -in:chats -category:promotions -category:social {subject:application subject:interview subject:recruitment subject:assessment subject:candidate subject:offer ${companies.join(" ")}}`;
}

/**
 * One check. Returns what it did; a failure is kept on the account, so
 * Settings can show it, and cleared by the next success.
 */
export async function syncInbox(options: SyncOptions = {}): Promise<SyncResult> {
  const { signal } = options;
  const [account, settings] = await Promise.all([loadGoogleAccount(), loadSettings()]);
  if (!account) throw new GoogleError("not-connected", "Connect your Google account in Settings → Google first.");
  try {
    const result = await runSync(options.lookbackDays ? null : account.historyId, account.email, options.jobOnly ? "known" : settings.gmailScope, signal, options);
    const unread = result.counts.unread ?? 0;
    const problem = unread ? `${unread} ${unread === 1 ? "message" : "messages"} couldn't be read from Gmail. The next check tries again.` : null;
    await prisma.googleAccount.update({ where: { id: account.id }, data: { lastSyncAt: new Date(), syncProblem: problem, ...(options.lookbackDays ? {} : { historyId: result.historyId }) } });
    return result.counts;
  } catch (error) {
    logServerError("inbox check", error instanceof GoogleError && error.detail ? new GoogleError(error.problem, `${error.message} (${error.detail})`) : error);
    const message = error instanceof GoogleError ? error.message : "The inbox check failed. It tries again on its own.";
    await prisma.googleAccount.updateMany({ where: { id: account.id }, data: { syncProblem: message } }).catch(() => {});
    throw error;
  }
}

async function runSync(historyId: string | null, ownAddress: string, scope: "known" | "all", signal?: AbortSignal, options: SyncOptions = {}) {
  const [applications, threads, aiReady] = await Promise.all([matchables(), knownThreads(), isAiConfigured()]);
  const trustedThreads = new Set(threads.keys());
  let ids: string[];
  let next: string;
  const since = historyId ? await messagesSince(historyId, signal) : null;
  if (since) {
    ids = since.ids;
    next = since.historyId;
  } else {
    // First check, or Gmail forgot where the last one was: look back a few weeks.
    next = await currentHistoryId(signal);
    ids = await searchMessages(options.jobOnly ? jobMailQuery(applications, options.lookbackDays ?? 30) : `${FIRST_LOOK} -in:chats -category:promotions -category:social`, { max: 200, signal });
  }

  const seen = new Set((await prisma.emailMessage.findMany({ where: { gmailId: { in: ids } }, select: { gmailId: true } })).map((entry) => entry.gmailId));
  const fresh = ids.filter((id) => !seen.has(id));
  const counts: SyncResult = { fetched: fresh.length, kept: 0, read: 0, unread: 0, ...(options.applyUpdates ? { updated: 0, reviewNeeded: 0 } : {}) };
  if (fresh.length === 0) return { historyId: next, counts };

  const kept: { id: string; tentative: boolean }[] = [];
  // Threads linked by the company's name or domain rather than the thread itself:
  // the AI unlinks a mail that turns out to be about something else (public issue 65).
  const tentativeThreads = new Set<string>();
  // Oldest first, so a thread's first mail links it for the ones after.
  const mails: ReadMail[] = [];
  for (const id of fresh) {
    try {
      // Metadata costs less quota and avoids reading unrelated message bodies.
      // Pace requests below the current 6,000 units/user/minute limit.
      await delay(350, undefined, { signal });
      await options.progress?.(`Checking email headers ${fresh.indexOf(id) + 1} of ${fresh.length}`);
      const metadata = await getMessage(id, signal, "metadata");
      if (!metadata || metadata.labels.some(label => NOISE_LABELS.includes(label))) continue;
      const sender = parseAddress(metadata.from);
      const match = matchMail({ threadId: metadata.threadId, fromName: sender.name, fromAddress: sender.address, subject: metadata.subject }, applications, threads);
      const outgoing = metadata.labels.includes("SENT") || sender.address === ownAddress.toLowerCase();
      if (!match && (outgoing || scope === "known" || !metadata.labels.includes("INBOX"))) continue;
      if (outgoing && match?.by !== "thread") continue;
      await delay(650, undefined, { signal });
      const mail = await getMessage(id, signal);
      if (mail) mails.push(mail);
    } catch (error) {
      // A message Google won't give right now, even asked again, doesn't stop
      // the check: the rest is read, and the history stays where it was, so
      // the message is listed again next time (public issue 68).
      if (!isPassing(error)) throw error;
      counts.unread++;
    }
  }
  mails.sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const mail of mails) {
    const from = parseAddress(mail.from);
    const outgoing = mail.labels.includes("SENT") || from.address === ownAddress.toLowerCase();
    if (mail.labels.some((label) => NOISE_LABELS.includes(label))) continue;
    const match = matchMail({ threadId: mail.threadId, fromName: from.name, fromAddress: from.address, subject: mail.subject }, applications, threads);
    // Your own mail only counts in a thread HireMe knows; other mail by the setting.
    if (!match && (outgoing || scope === "known" || !mail.labels.includes("INBOX"))) continue;
    if (outgoing && match?.by !== "thread") continue;

    const created = await prisma.emailMessage.upsert({
      where: { gmailId: mail.id },
      create: {
        gmailId: mail.id,
        threadId: mail.threadId,
        applicationId: match?.applicationId ?? null,
        direction: outgoing ? EmailDirection.OUTGOING : EmailDirection.INCOMING,
        fromName: from.name,
        fromAddress: from.address,
        toAddress: mail.to,
        subject: mail.subject,
        messageId: mail.messageId,
        body: stripQuoted(mail.text).slice(0, MAX_BODY),
        sentAt: mail.date,
        // Your own messages need no answer.
        handledAt: outgoing ? mail.date : null,
      },
      update: {},
    });
    if (match) threads.set(mail.threadId, match.applicationId);
    if (match && match.by !== "thread") tentativeThreads.add(mail.threadId);
    counts.kept++;
    if (!outgoing) kept.push({ id: created.id, tentative: Boolean(match) && tentativeThreads.has(mail.threadId) });
  }

  if (aiReady) {
    for (const { id, tentative } of kept) {
      if (signal?.aborted) break;
      try {
        await options.progress?.(`Reading job reply ${kept.findIndex((entry) => entry.id === id) + 1} of ${kept.length}`);
        await readReply(id, signal, { tentative });
        counts.read++;
        if (options.applyUpdates) {
          const email = await prisma.emailMessage.findUniqueOrThrow({ where: { id } });
          const from = parseAddress(email.fromAddress);
          const domain = baseDomain(domainOf(from.address));
          const uniqueDomain = applications.filter(app => app.status !== "DRAFT" && companyDomains(app).has(domain)).length === 1;
          if (email.applicationId && email.suggestedStatus && (trustedThreads.has(email.threadId) || uniqueDomain)) {
            const app = await prisma.application.findUnique({ where: { id: email.applicationId } });
            if (app && worthSuggesting(app.status, email.suggestedStatus)) {
              await applyStatusChange(prisma, app.id, email.suggestedStatus);
              await prisma.emailMessage.update({ where: { id }, data: { suggestedStatus: null } });
              counts.updated = (counts.updated ?? 0) + 1;
            }
          } else if (email.suggestedStatus) counts.reviewNeeded = (counts.reviewNeeded ?? 0) + 1;
        }
      } catch (error) {
        // Left unread; "Read again" in the inbox tries once more.
        counts.unread++;
        logServerError("reading a reply", error);
      }
    }
  }
  // While a message was left unread, the history stays where it was, so it's
  // listed again next time; advancing past it would drop it for good.
  return { historyId: counts.unread && historyId ? historyId : next, counts };
}

/** Has the AI read a kept mail: what it is, what it asks, and the status it suggests. */
export async function readReply(emailId: string, signal?: AbortSignal, { tentative = false }: { tentative?: boolean } = {}): Promise<void> {
  const email = await prisma.emailMessage.findUniqueOrThrow({
    where: { id: emailId },
    include: { application: { select: { company: true, role: true, status: true } } },
  });
  const [provider, options, settings] = await Promise.all([getAiProvider(), loadTaskOptions(), loadSettings()]);
  const { data, promptVersion } = await classifyReply(
    provider,
    {
      from: [email.fromName, `<${email.fromAddress}>`].filter(Boolean).join(" "),
      subject: email.subject,
      body: email.body,
      sentAt: email.sentAt,
      // Never the server's own zone: in a container that's UTC, which read "13:00" two hours off.
      timeZone: settings.workTimeZone ?? (await lastKnownTimeZone()),
      application: email.application ? [email.application.role, email.application.company].filter(Boolean).join(" at ") : null,
    },
    { ...options, signal },
  );
  const current = email.application?.status ?? ApplicationStatus.SENT;
  const unlink = tentative && email.applicationId !== null && data.unrelated;
  await prisma.$transaction([
    prisma.emailMessage.update({
      where: { id: emailId },
      data: {
        ...(unlink ? { applicationId: null } : {}),
        kind: data.kind,
        summary: data.summary,
        questions: data.questions,
        suggestedStatus: !unlink && email.application && worthSuggesting(current, data.suggestedStatus) ? data.suggestedStatus : null,
        confirmedAt: data.confirmedAt,
        classifiedWith: promptVersion,
        // Acknowledgements and rejections need no answer.
        ...(data.kind === "ACKNOWLEDGEMENT" || data.kind === "REJECTION" ? { handledAt: new Date() } : {}),
      },
    }),
    // The thread was linked through this mail, so the rest of it goes with it.
    ...(unlink
      ? [prisma.emailMessage.updateMany({ where: { threadId: email.threadId, applicationId: email.applicationId }, data: { applicationId: null, suggestedStatus: null } })]
      : []),
  ]);
}

export const inboxCheckRunning = () => Boolean(globalForSync.inboxRunning);

const globalForSync = globalThis as unknown as { inboxTimer?: ReturnType<typeof setTimeout>; inboxRunning?: boolean };

/** One scheduled check: interviews changed in Google Calendar, then new mail while reading is on. */
async function scheduledCheck(): Promise<void> {
  if (globalForSync.inboxRunning) return;
  const [connection, settings] = await Promise.all([googleConnection(), loadSettings()]);
  if (connection.status !== "connected") return;
  globalForSync.inboxRunning = true;
  try {
    // Interviews moved or deleted in Google Calendar, whether or not mail is read.
    await pullInterviewEvents().catch((error) => logServerError("calendar check", error));
    if (connection.canRead && settings.gmailRead) await syncInbox();
  } finally {
    globalForSync.inboxRunning = false;
  }
}

/** Runs a check now unless one is running; for "Check now". */
export async function checkInboxNow(options: SyncOptions = {}): Promise<SyncResult | null> {
  if (globalForSync.inboxRunning) return null;
  globalForSync.inboxRunning = true;
  try {
    return await syncInbox(options);
  } finally {
    globalForSync.inboxRunning = false;
  }
}

/** Starts the inbox timer, once per process (dev reloads keep the one they have). */
export function startInboxSchedule(): void {
  if (globalForSync.inboxTimer) return;
  const schedule = async () => {
    const minutes = (await loadSettings().catch(() => null))?.gmailInterval ?? 10;
    globalForSync.inboxTimer = setTimeout(() => {
      void scheduledCheck()
        .catch(() => {})
        .finally(() => void schedule());
    }, minutes * 60_000);
    globalForSync.inboxTimer.unref?.();
  };
  void schedule();
}
