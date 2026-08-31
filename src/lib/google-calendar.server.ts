import { google } from "googleapis";
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

/** Credentials live in the DB so they can be changed from /admin/integrations. */
export async function isGoogleCalendarConfigured(): Promise<boolean> {
  const s = await getSettings();
  return Boolean(s.googleClientId && s.googleClientSecret && s.googleRefreshToken);
}

export function buildOAuthClient(
  clientId: string,
  clientSecret: string,
  redirectUri?: string,
) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function getAuthedClient() {
  const s = await getSettings();
  const auth = buildOAuthClient(s.googleClientId, s.googleClientSecret);
  auth.setCredentials({ refresh_token: s.googleRefreshToken });
  return auth;
}

async function getCalendarClient() {
  return google.calendar({ version: "v3", auth: await getAuthedClient() });
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
  if (!(await isGoogleCalendarConfigured())) return [];

  const settings = await getSettings();
  const calendar = await getCalendarClient();

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      timeZone: settings.timezone,
      items: [{ id: settings.googleCalendarId }],
    },
  });

  const busy = res.data.calendars?.[settings.googleCalendarId]?.busy ?? [];
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
  if (!(await isGoogleCalendarConfigured())) return null;

  const settings = await getSettings();
  const calendar = await getCalendarClient();

  const res = await calendar.events.insert({
    calendarId: settings.googleCalendarId,
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
  if (!(await isGoogleCalendarConfigured())) return;
  const settings = await getSettings();
  const calendar = await getCalendarClient();
  await calendar.events.delete({ calendarId: settings.googleCalendarId, eventId }).catch(() => {
    // Event may already be gone — not fatal for a status update.
  });
}

// --------------------------------------------------------------------------
// OAuth connect flow, driven entirely from /admin/integrations so nobody has
// to run a CLI script. The owner registers a redirect URI once in Google
// Cloud Console, then clicks Connect and approves in the browser.
// --------------------------------------------------------------------------

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

export function buildConsentUrl(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): string {
  return buildOAuthClient(clientId, clientSecret, redirectUri).generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    // Without this Google only returns a refresh token the *first* time an
    // account authorises the app, so re-connecting would silently yield none.
    prompt: "consent",
    include_granted_scopes: true,
  });
}

/** Swap the ?code= from the redirect for a long-lived refresh token. */
export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<{ refreshToken: string; email: string }> {
  const client = buildOAuthClient(clientId, clientSecret, redirectUri);
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google didn't return a refresh token. Remove this app at " +
        "myaccount.google.com/permissions and connect again.",
    );
  }

  client.setCredentials(tokens);
  let email = "";
  try {
    const info = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
    email = info.data.email ?? "";
  } catch {
    // Not fatal — we only use this for display.
  }

  return { refreshToken: tokens.refresh_token, email };
}

export interface CalendarOption {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

/** Calendars the connected account can write to. */
export async function listCalendars(): Promise<CalendarOption[]> {
  if (!(await isGoogleCalendarConfigured())) return [];
  const calendar = await getCalendarClient();
  const res = await calendar.calendarList.list({ maxResults: 100 });

  return (res.data.items ?? [])
    .filter((c) => c.id && (c.accessRole === "owner" || c.accessRole === "writer"))
    .map((c) => ({
      id: c.id!,
      summary: c.summary ?? c.id!,
      primary: Boolean(c.primary),
      accessRole: c.accessRole ?? "",
    }));
}

/** Round-trip check so the owner gets a definite yes/no. */
export async function testConnection(): Promise<{ ok: boolean; detail: string }> {
  if (!(await isGoogleCalendarConfigured())) {
    return { ok: false, detail: "Not connected yet." };
  }
  try {
    const settings = await getSettings();
    const calendar = await getCalendarClient();
    const cal = await calendar.calendars.get({ calendarId: settings.googleCalendarId });
    const now = new Date();
    const busy = await getBusyIntervals(
      now.toISOString(),
      new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    );
    return {
      ok: true,
      detail: `Connected to "${cal.data.summary}". ${busy.length} busy block(s) in the next 7 days.`,
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "Connection failed." };
  }
}
