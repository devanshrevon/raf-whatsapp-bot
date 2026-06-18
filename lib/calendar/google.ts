import { google, type calendar_v3 } from "googleapis";
import { env } from "@/lib/env";
import { APP_TIMEZONE } from "@/lib/calendar/timezone";
import type { Interval } from "@/lib/calendar/slots";

// Google Calendar I/O (spec §14, §15). OAuth2 with a long-lived refresh token,
// per the env.google.* config. Calendar is the source of truth for availability
// and confirmed appointments — the AI never invents either.

let calendar: calendar_v3.Calendar | undefined;

function getCalendar(): calendar_v3.Calendar {
  if (!calendar) {
    const auth = new google.auth.OAuth2(
      env.google.clientId,
      env.google.clientSecret,
      env.google.redirectUri
    );
    auth.setCredentials({ refresh_token: env.google.refreshToken });
    calendar = google.calendar({ version: "v3", auth });
  }
  return calendar;
}

/** Busy intervals in [timeMin, timeMax) from the configured calendar. */
export async function getBusyIntervals(
  timeMin: Date,
  timeMax: Date
): Promise<Interval[]> {
  const res = await getCalendar().freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: APP_TIMEZONE,
      items: [{ id: env.google.calendarId }],
    },
  });

  const busy = res.data.calendars?.[env.google.calendarId]?.busy ?? [];
  return busy
    .filter((b) => b.start && b.end)
    .map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }));
}

export async function createCalendarEvent(input: {
  summary: string;
  description: string;
  start: Date;
  end: Date;
}): Promise<string> {
  const res = await getCalendar().events.insert({
    calendarId: env.google.calendarId,
    requestBody: {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start.toISOString(), timeZone: APP_TIMEZONE },
      end: { dateTime: input.end.toISOString(), timeZone: APP_TIMEZONE },
    },
  });

  const id = res.data.id;
  if (!id) throw new Error("Google Calendar did not return an event id");
  return id;
}

export async function updateCalendarEvent(
  eventId: string,
  input: { start: Date; end: Date }
): Promise<void> {
  await getCalendar().events.patch({
    calendarId: env.google.calendarId,
    eventId,
    requestBody: {
      start: { dateTime: input.start.toISOString(), timeZone: APP_TIMEZONE },
      end: { dateTime: input.end.toISOString(), timeZone: APP_TIMEZONE },
    },
  });
}

export async function cancelCalendarEvent(eventId: string): Promise<void> {
  await getCalendar().events.delete({
    calendarId: env.google.calendarId,
    eventId,
  });
}
