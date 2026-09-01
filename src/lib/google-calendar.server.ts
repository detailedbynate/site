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

  try {
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMinISO,
        timeMax: timeMaxISO,
        timeZone: settings.timezone,
        items: [{ id: settings.googleCalendarId }],
      },
    });

    const calendars = res.data.calendars ?? {};

    /*
      Read every calendar in the response rather than looking up our own id.

      Google keys this object by the calendar it RESOLVED, not the string we
      sent. Ask for "primary" — which is the default here — and the reply
      comes back keyed by the real address, e.g. "you@gmail.com". Looking up
      `calendars["primary"]` therefore found nothing, fell through to `[]`,
      and every busy event was silently ignored: the booking form showed the
      whole week as free no matter what was in the calendar.

      Only one calendar is ever requested, so merging them all is safe.
    */
    const busy = Object.values(calendars).flatMap((c) => c?.busy ?? []);

    // Google reports per-calendar problems in here instead of throwing —
    // a wrong id or a revoked share shows up as `notFound`.
    const problems = Object.values(calendars).flatMap((c) => c?.errors ?? []);
    if (problems.length) {
      await recordCalendarError(
        `Calendar "${settings.googleCalendarId}": ${problems
          .map((e) => e.reason ?? "unknown error")
          .join(", ")}`,
      );
    } else if (busy.length || Object.keys(calendars).length) {
      await clearCalendarError();
    }

    return busy
      .filter((b): b is { start: string; end: string } => Boolean(b.start && b.end))
      .map((b) => ({ start: b.start, end: b.end }));
  } catch (err) {
    // Availability must still render if Google is unreachable — but record
    // why, so it isn't invisible. Treating everything as free is the safe
    // direction: it can double-book, never lose a booking, and the local
    // booking check still runs.
    await recordCalendarError(googleMessage(err));
    console.error("Google Calendar freebusy failed:", err);
    return [];
  }
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
