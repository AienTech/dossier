import "server-only";

import { googleFetch } from "./account";
import { googleUrl } from "./endpoints";
import type { Interval } from "./slots";

// The parts of the Calendar API Dossier uses (E15-5).

const api = (path: string) => googleUrl("www", `/calendar/v3${path}`);

/** Busy times in the calendar between `from` and `to`. */
export async function busyTimes(calendarId: string, from: Date, to: Date, signal?: AbortSignal): Promise<Interval[]> {
  const answer = await googleFetch<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>("calendar", api("/freeBusy"), {
    method: "POST",
    body: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: calendarId }] },
    signal,
  });
  const calendar = answer.calendars?.[calendarId] ?? Object.values(answer.calendars ?? {})[0];
  return (calendar?.busy ?? []).map((entry) => ({ start: new Date(entry.start), end: new Date(entry.end) }));
}

export type InterviewEvent = {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  timeZone: string;
  /** Who's interviewing, so they get the invitation too. */
  attendees?: string[];
};

/** Adds an event; returns its id and link. */
export async function createEvent(calendarId: string, event: InterviewEvent): Promise<{ id: string; htmlLink: string }> {
  const created = await googleFetch<{ id: string; htmlLink: string }>(
    "calendar",
    api(`/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`),
    {
      method: "POST",
      body: {
        summary: event.summary,
        description: event.description,
        start: { dateTime: event.start.toISOString(), timeZone: event.timeZone },
        end: { dateTime: event.end.toISOString(), timeZone: event.timeZone },
        attendees: event.attendees?.map((email) => ({ email })),
        reminders: { useDefault: true },
      },
    },
  );
  return { id: created.id, htmlLink: created.htmlLink };
}
