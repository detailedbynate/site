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

/**
 * Pull the useful sentence out of a googleapis error.
 *
 * Its errors bury the real reason several levels down, and the top-level
 * `message` is often just "Request failed with status code 403".
 */
export function googleMessage(err: unknown): string {
  const e = err as {
    response?: { data?: { error?: { message?: string; errors?: { reason?: string }[] } } };
    errors?: { message?: string; reason?: string }[];
    message?: string;
  };
  const api = e?.response?.data?.error;
  const reason = api?.errors?.[0]?.reason ?? e?.errors?.[0]?.reason;
  const message = api?.message ?? e?.errors?.[0]?.message ?? e?.message ?? "Unknown error";
  return reason ? `${message} (${reason})` : message;
}

/**
 * Remember why the last calendar call failed.
 *
 * Both calendar paths are deliberately non-fatal — a booking must never be
 * lost because Google is down — which meant every failure was completely
 * silent. The owner saw "Connected" and no events, with nothing to go on.
 * This is what Integrations shows them instead.
 */
export async function recordCalendarError(detail: string): Promise<void> {
  const { updateSettings } = await import("./db.server");
  await updateSettings({
    googleLastError: detail.slice(0, 300),
    googleLastErrorAt: new Date().toISOString(),
  }).catch(() => undefined);
}

export async function clearCalendarError(): Promise<void> {
  const s = await getSettings();
  if (!s.googleLastError) return;
  const { updateSettings } = await import("./db.server");
  await updateSettings({ googleLastError: "", googleLastErrorAt: "" }).catch(() => undefined);
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
  /** The Google event id this came from, so a booking can ignore its own. */
  eventId?: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  /** Instant the event starts, resolved into the business timezone. */
  startISO: string;
  endISO: string;
  /** YYYY-MM-DD in the business timezone, for grouping into a month grid. */
  date: string;
  allDay: boolean;
  /** Marked "Free" in Google. All-day events are Free by DEFAULT. */
  free: boolean;
  location?: string;
  htmlLink?: string;
}

/** The shape of a Google event we care about; a subset of calendar_v3.Schema$Event. */
export interface RawGoogleEvent {
  id?: string | null;
  summary?: string | null;
  status?: string | null;
  transparency?: string | null;
  location?: string | null;
  htmlLink?: string | null;
  start?: { date?: string | null; dateTime?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null } | null;
  attendees?: { self?: boolean | null; responseStatus?: string | null }[] | null;
}

/**
 * One Google event turned into our own shape, or null if it should be
 * ignored entirely (cancelled, declined, or missing both time forms).
 *
 * Exported so it can be tested directly against real API payload shapes —
 * the all-day and timezone handling here is where the bugs live, and it is
 * otherwise only reachable behind a network call.
 */
export function normalizeEvent(e: RawGoogleEvent, timeZone: string): CalendarEvent | null {
  // Events you were invited to and declined are not commitments.
  const declined = (e.attendees ?? []).some((a) => a.self && a.responseStatus === "declined");
  if (declined || e.status === "cancelled") return null;

  const allDay = Boolean(e.start?.date);
  let startISO: string;
  let endISO: string;

  if (allDay) {
    // All-day events carry plain dates, and `end.date` is EXCLUSIVE, so a
    // one-day event reads 2026-09-02 -> 2026-09-03. Resolving both against
    // the business timezone is what makes a day off block that local day
    // rather than a UTC one.
    startISO = zonedDateToISO(e.start!.date!, timeZone);
    endISO = zonedDateToISO(e.end?.date ?? e.start!.date!, timeZone);
  } else {
    if (!e.start?.dateTime || !e.end?.dateTime) return null;
    startISO = new Date(e.start.dateTime).toISOString();
    endISO = new Date(e.end.dateTime).toISOString();
  }

  return {
    id: e.id ?? "",
    summary: e.summary ?? "(no title)",
    startISO,
    endISO,
    date: dateInZone(startISO, timeZone),
    allDay,
    free: e.transparency === "transparent",
    location: e.location ?? undefined,
    htmlLink: e.htmlLink ?? undefined,
  };
}

/**
 * Every event on the configured calendar between two instants, recurrences
 * already expanded into individual occurrences.
 *
 * Returns [] if Google isn't configured, so the booking form still works
 * before credentials are wired up.
 */
export async function listCalendarEvents(
  timeMinISO: string,
  timeMaxISO: string,
): Promise<CalendarEvent[]> {
  if (!(await isGoogleCalendarConfigured())) return [];

  const settings = await getSettings();
  const calendar = await getCalendarClient();

  try {
    const res = await calendar.events.list({
      calendarId: settings.googleCalendarId,
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      // Expand recurring events into occurrences; without this a weekly
      // "day off" arrives as one master event and blocks only its first week.
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500,
      timeZone: settings.timezone,
    });

    await clearCalendarError();

    const out: CalendarEvent[] = [];
    for (const e of res.data.items ?? []) {
      const normalized = normalizeEvent(e, settings.timezone);
      if (normalized) out.push(normalized);
    }
    return out;
  } catch (err) {
    await recordCalendarError(googleMessage(err));
    console.error("Google Calendar events.list failed:", err);
    return [];
  }
}

/** Midnight of a YYYY-MM-DD in a given timezone, as a UTC instant. */
function zonedDateToISO(date: string, timeZone: string): string {
  const guess = new Date(`${date}T00:00:00Z`).getTime();
  // Two passes: the offset itself depends on the instant (DST), so resolve
  // once with a rough guess and again with the corrected one.
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    // Refine in place. Re-basing on `guess` each pass would undo the first
    // correction and hand back the guess unchanged.
    ms += guess - zonedWallClockMs(ms, timeZone);
  }
  return new Date(ms).toISOString();
}

/** What `instant` reads as on a wall clock in `timeZone`, as a UTC-epoch ms. */
function zonedWallClockMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** YYYY-MM-DD that an instant falls on, in a given timezone. */
function dateInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * Whether an event stops customers booking over it.
 *
 * All-day events always block. A TIMED event marked "Free" does not — that
 * is a deliberate "I am available during this". The asymmetry is the whole
 * point: Google makes all-day events Free by default, so honouring that flag
 * for them would ignore the most common way of saying "I am off that day".
 */
export function blocksBooking(e: CalendarEvent): boolean {
  return e.allDay || !e.free;
}

/**
 * The intervals that should block booking, between two ISO timestamps.
 *
 * Built from events.list rather than freebusy.query, deliberately.
 * freebusy only reports events whose transparency is "opaque" — and Google
 * makes all-day events "Free" BY DEFAULT. So the single most common way to
 * say "I am not working that day", blocking the whole day out in Google,
 * produced a freebusy response with nothing in it, and the booking form
 * offered the day as wide open. Listing events and deciding here means what
 * you see on your calendar is what customers cannot book over.
 *
 * The one thing still honoured: a TIMED event you explicitly marked Free.
 * That is a deliberate "I am available during this" and is left bookable.
 * All-day events block regardless, because their Free status is a default
 * nobody chose.
 *
 * Returns [] (everything free) if Google isn't configured.
 */
export async function getBusyIntervals(
  timeMinISO: string,
  timeMaxISO: string,
): Promise<BusyInterval[]> {
  const events = await listCalendarEvents(timeMinISO, timeMaxISO);
  return events.filter(blocksBooking).map((e) => ({
    start: e.startISO,
    end: e.endISO,
    eventId: e.id,
  }));
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

  const body = {
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: { dateTime: input.startISO, timeZone: settings.timezone },
    end: { dateTime: input.endISO, timeZone: settings.timezone },
    attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
    reminders: { useDefault: true },
  };

  try {
    const res = await calendar.events.insert({
      calendarId: settings.googleCalendarId,
      sendUpdates: input.attendeeEmail ? "all" : "none",
      requestBody: body,
    });
    await clearCalendarError();
    return res.data.id ?? null;
  } catch (err) {
    const detail = googleMessage(err);

    /*
      Retry without the attendee.

      Inviting someone needs more permission than writing to your own
      calendar, and some accounts refuse it outright (`forbiddenForServiceAccounts`,
      or a Workspace policy on external invites). That refusal killed the
      whole insert, so no event appeared at all. Far better to put the job on
      the calendar without the invite than to drop it silently — the
      customer's details are in the description either way.
    */
    if (input.attendeeEmail && /attende|forbidden|invit/i.test(detail)) {
      try {
        const res = await calendar.events.insert({
          calendarId: settings.googleCalendarId,
          sendUpdates: "none",
          requestBody: { ...body, attendees: undefined },
        });
        await recordCalendarError(
          `Event created, but the customer could not be invited: ${detail}`,
        );
        return res.data.id ?? null;
      } catch (retryErr) {
        await recordCalendarError(googleMessage(retryErr));
        throw retryErr;
      }
    }

    await recordCalendarError(detail);
    throw err;
  }
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

/**
 * Prove the connection actually works, in both directions.
 *
 * The old version only read the calendar, so it reported "Connected" on an
 * account that could not create a single event. It now also writes a real
 * event and deletes it, because writing is the permission that matters and
 * the one that silently fails.
 */
export async function testConnection(): Promise<{ ok: boolean; detail: string }> {
  if (!(await isGoogleCalendarConfigured())) {
    return { ok: false, detail: "Not connected yet." };
  }

  const settings = await getSettings();
  const calendar = await getCalendarClient();

  // 1. Can we see the calendar at all?
  let name: string;
  try {
    const cal = await calendar.calendars.get({ calendarId: settings.googleCalendarId });
    name = cal.data.summary ?? settings.googleCalendarId;
  } catch (err) {
    const detail = `Can't open calendar "${settings.googleCalendarId}": ${googleMessage(err)}`;
    await recordCalendarError(detail);
    return { ok: false, detail };
  }

  // 2. Can we read busy times? This is what blocks days on the booking form.
  const now = new Date();
  const busy = await getBusyIntervals(
    now.toISOString(),
    new Date(now.getTime() + 7 * 86_400_000).toISOString(),
  );

  // 3. Can we write? Created a year out at midnight so it is invisible even
  //    in the unlikely event the delete fails.
  const start = new Date(now.getTime() + 365 * 86_400_000);
  start.setHours(3, 0, 0, 0);
  const end = new Date(start.getTime() + 15 * 60_000);

  let created: string | null = null;
  try {
    const res = await calendar.events.insert({
      calendarId: settings.googleCalendarId,
      requestBody: {
        summary: "Detailed by Nate — connection test (safe to delete)",
        description: "Created by the admin's Test connection button. Removed automatically.",
        start: { dateTime: start.toISOString(), timeZone: settings.timezone },
        end: { dateTime: end.toISOString(), timeZone: settings.timezone },
      },
    });
    created = res.data.id ?? null;
  } catch (err) {
    const detail = `Reading works, but creating an event failed: ${googleMessage(err)}`;
    await recordCalendarError(detail);
    return { ok: false, detail };
  } finally {
    if (created) {
      await calendar.events
        .delete({ calendarId: settings.googleCalendarId, eventId: created })
        .catch(() => undefined);
    }
  }

  await clearCalendarError();
  return {
    ok: true,
    detail:
      `Connected to "${name}". Reading and writing both work — ` +
      `${busy.length} busy block${busy.length === 1 ? "" : "s"} found in the next 7 days.`,
  };
}
