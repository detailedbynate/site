import { google } from "googleapis";
import { getServerConfig, isGoogleCalendarConfigured } from "./config.server";
import { getSettings } from "./db.server";

// --------------------------------------------------------------------------
// Server-only. Never imported from client code — the .server.ts suffix
// keeps this (and the `googleapis` package it pulls in) out of the browser
// bundle entirely.
//
// Auth model: a single OAuth2 "offline" refresh token for the business's
// own Google account (not per-customer OAuth — customers never see a
// Google login). See scripts/get-google-refresh-token.mjs for how to mint
// this once during setup.
// --------------------------------------------------------------------------

function getAuthedClient() {
  const cfg = getServerConfig();
  const auth = new google.auth.OAuth2(cfg.googleClientId, cfg.googleClientSecret);
  auth.setCredentials({ refresh_token: cfg.googleRefreshToken });
  return auth;
}

function getCalendarClient() {
  return google.calendar({ version: "v3", auth: getAuthedClient() });
}

export interface BusyInterval {
  start: string; // ISO
  end: string; // ISO
}

/**
 * Returns the busy intervals on the configured calendar between two ISO
 * timestamps. Returns [] (treats everything as free) if Google Calendar
 * isn't configured yet, so local dev / the booking form still works before
 * you've wired up credentials — see README.
 */
export async function getBusyIntervals(timeMinISO: string, timeMaxISO: string): Promise<BusyInterval[]> {
  if (!isGoogleCalendarConfigured()) return [];

  const cfg = getServerConfig();
  const settings = await getSettings();
  const calendar = getCalendarClient();

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      timeZone: settings.timezone,
      items: [{ id: cfg.googleCalendarId }],
    },
  });

  const busy = res.data.calendars?.[cfg.googleCalendarId]?.busy ?? [];
  return busy
    .filter((b): b is { start: string; end: string } => Boolean(b.start && b.end))
    .map((b) => ({ start: b.start, end: b.end }));
}

export interface CreateEventInput {
  summary: string;
  description: string;
  startISO: string;
  endISO: string;
  attendeeEmail?: string;
  /** Shown on the calendar entry and used for directions on mobile jobs. */
  location?: string;
}

/**
 * Creates a calendar event for a confirmed booking. Returns the created
 * event's id (stored on the booking so it can be looked up/cancelled
 * later), or null if Google Calendar isn't configured — the booking still
 * saves locally either way.
 */
export async function createCalendarEvent(input: CreateEventInput): Promise<string | null> {
  if (!isGoogleCalendarConfigured()) return null;

  const cfg = getServerConfig();
  const settings = await getSettings();
  const calendar = getCalendarClient();

  const res = await calendar.events.insert({
    calendarId: cfg.googleCalendarId,
    sendUpdates: input.attendeeEmail ? "all" : "none",
    requestBody: {
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: { dateTime: input.startISO, timeZone: settings.timezone },
      end: { dateTime: input.endISO, timeZone: settings.timezone },
      attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
      reminders: { useDefault: true },
    },
  });

  return res.data.id ?? null;
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  if (!isGoogleCalendarConfigured()) return;
  const cfg = getServerConfig();
  const calendar = getCalendarClient();
  await calendar.events.delete({ calendarId: cfg.googleCalendarId, eventId }).catch(() => {
    // Event may already be gone — not fatal for a status update.
  });
}
