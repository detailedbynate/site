import { getBusyIntervals } from "./google-calendar.server";
import { getSettings, listBookingsForDate } from "./db.server";

// Business rules now live in the database (editable at /admin/settings)
// rather than in env vars, so the owner can change hours without a redeploy.
// getSettings() is the single source; env vars only seed the defaults on
// first run (see DEFAULT_SETTINGS in db.server.ts).

export interface TimeRange {
  startMinutes: number; // minutes from midnight, local business time
  endMinutes: number;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60)
    .toString()
    .padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

// Converts a "wall clock" date+minutes-from-midnight pair, interpreted in
// the business timezone, into a UTC ISO string — without pulling in a
// timezone library. We ask Intl for the zone's current UTC offset and
// apply it. This is accurate for a fixed offset; if the slot ever falls on
// a DST transition day the offset is still correct because we look it up
// for that specific date.
function zonedTimeToISO(dateStr: string, minutesFromMidnight: number, timeZone: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const naiveUTC = Date.UTC(year, month - 1, day, 0, minutesFromMidnight / 60, minutesFromMidnight % 60);

  // Find the offset for this date in the target timezone by formatting a
  // guess and comparing back, then correcting once (handles all real-world
  // offsets, including half/quarter hour zones).
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const asIfUTC = new Date(naiveUTC);
  const parts = dtf.formatToParts(asIfUTC).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const shownAsUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = shownAsUTC - naiveUTC;
  const correctedUTC = naiveUTC - offsetMs;
  return new Date(correctedUTC).toISOString();
}

export interface SlotResult {
  startTime: string; // HH:mm
  startISO: string;
  endISO: string;
}

/**
 * Returns bookable start times for `date` (YYYY-MM-DD) for a service of
 * `durationMinutes`, stepping every `slotIncrementMinutes`, within business
 * hours, excluding anything that overlaps a Google Calendar busy interval
 * or an existing local booking.
 */
/**
 * The base trading hours for a given date, honouring the mobile-specific
 * schedule when the customer has chosen mobile service. Returns null when
 * the shop is closed that day.
 */
function hoursForDate(
  cfg: Awaited<ReturnType<typeof getSettings>>,
  date: string,
  location?: "mobile" | "shop",
): { openMin: number; closeMin: number } | null {
  const week =
    location === "mobile" && cfg.mobileScheduleEnabled ? cfg.mobileSchedule : cfg.weeklySchedule;
  const day = week?.[dayOfWeek(date)];
  if (!day || !day.open) return null;
  if (day.closeHour <= day.openHour) return null;
  return { openMin: day.openHour * 60, closeMin: day.closeHour * 60 };
}

export async function getAvailableSlots(
  date: string,
  durationMinutes: number,
  /** Exclude one booking from the busy set — used when rescheduling it. */
  ignoreBookingId?: string,
  location?: "mobile" | "shop",
): Promise<SlotResult[]> {
  const cfg = await getSettings();

  // Enforce the booking window HERE, not just when building the calendar.
  // getAvailableDays() greys out past/too-soon days, but that is only a
  // client-side hint; createBooking re-checks against this function, so
  // without this guard a crafted request could book in the past or inside
  // the notice period.
  const today = todayInZone(cfg.timezone);
  const cutoff = leadTimeCutoff(cfg.leadDays);
  const latest = addDays(today, Math.max(cfg.bookingWindowDays - 1, 0));
  // Cheap reject: the whole day is before the notice cutoff, or past the
  // window. The per-slot check below is what actually enforces the notice.
  if (date < dateOfInstant(cutoff, cfg.timezone) || date > latest) return [];

  const hours = hoursForDate(cfg, date, location);
  if (!hours) return [];
  const { openMin, closeMin } = hours;
  const step = cfg.slotIncrementMinutes;

  const dayStartISO = zonedTimeToISO(date, 0, cfg.timezone);
  const dayEndISO = zonedTimeToISO(date, 24 * 60, cfg.timezone);

  const [googleBusy, localBookings] = await Promise.all([
    getBusyIntervals(dayStartISO, dayEndISO),
    listBookingsForDate(date),
  ]);

  // When rescheduling, skip the calendar event this booking already created.
  // The local booking is excluded below via ignoreBookingId; without this its
  // Google twin would still block, so a job could never move within its own
  // day. (Latent until now: freebusy returned no ids to match on.)
  const ownEventId = ignoreBookingId
    ? localBookings.find((b) => b.id === ignoreBookingId)?.googleEventId
    : undefined;

  /*
    Convert each Google busy block to minutes from the START OF THIS DAY, then
    clamp it to the day.

    This used to read the clock time out of each timestamp and throw the date
    away, which silently broke the most common case of all. An all-day event
    runs 00:00 -> next day 00:00, so it became 0 -> 0: a zero-width range that
    blocked nothing. Multi-day events collapsed the same way, and anything
    running past midnight came out negative. Only a plain same-day timed event
    ever worked, which is why marking a day off in Google did nothing here.

    Measuring against dayStartISO (already the zoned midnight as an instant)
    needs no timezone maths and handles DST for free, because both sides are
    real instants.
  */
  const dayStartMs = new Date(dayStartISO).getTime();
  const offsetMinutes = (iso: string) => (new Date(iso).getTime() - dayStartMs) / 60_000;

  const busyRangesMin: TimeRange[] = [
    ...googleBusy
      .filter((b) => !ownEventId || b.eventId !== ownEventId)
      .map((b) => ({
        startMinutes: Math.max(0, offsetMinutes(b.start)),
        endMinutes: Math.min(24 * 60, offsetMinutes(b.end)),
      })),
    ...localBookings
      .filter((b) => b.id !== ignoreBookingId)
      .map((b) => ({
        startMinutes: timeToMinutes(b.startTime),
        endMinutes: timeToMinutes(b.startTime) + b.durationMinutes,
      })),
  ];

  const slots: SlotResult[] = [];

  for (let start = openMin; start + durationMinutes <= closeMin; start += step) {
    const end = start + durationMinutes;
    const overlaps = busyRangesMin.some((r) => start < r.endMinutes && end > r.startMinutes);
    if (overlaps) continue;

    const startISO = zonedTimeToISO(date, start, cfg.timezone);
    // The real notice rule: a slot must be at least leadDays * 24h away.
    // This used to be a whole-day comparison, so with one day's notice set,
    // booking at 11pm on the 1st still offered 8:30am on the 2nd - nine and
    // a half hours, not a day. Comparing instants makes the setting mean
    // what it says, and it also subsumes the old "not in the past" check
    // (with zero notice the cutoff is simply now).
    if (new Date(startISO) < cutoff) continue;

    slots.push({
      startTime: minutesToTime(start),
      startISO,
      endISO: zonedTimeToISO(date, end, cfg.timezone),
    });
  }

  return slots;
}

/** The earliest instant a booking may start, given the notice setting. */
function leadTimeCutoff(leadDays: number): Date {
  return new Date(Date.now() + Math.max(leadDays, 0) * 24 * 60 * 60 * 1000);
}

/** The YYYY-MM-DD an instant falls on, in the business timezone. */
function dateOfInstant(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export type DayUnavailableReason = "closed" | "booked" | "lead-time";

export interface DayAvailability {
  date: string; // YYYY-MM-DD
  available: boolean;
  slotCount: number;
  reason?: DayUnavailableReason;
}

/** Today's date as YYYY-MM-DD in the business timezone (not the server's). */
function todayInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Day of week (0=Sun) for a YYYY-MM-DD, computed calendar-only (no TZ shift). */
function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Availability for the whole booking window in one pass, so the calendar can
 * grey out closed / fully-booked / too-soon days instead of hiding them.
 *
 * Days ruled out by a static rule (closed weekday, inside the lead-time
 * window) short-circuit before touching Google Calendar, so this costs one
 * freebusy call per *candidate* day rather than per day shown.
 */
export async function getAvailableDays(
  durationMinutes: number,
  ignoreBookingId?: string,
  location?: "mobile" | "shop",
): Promise<DayAvailability[]> {
  const cfg = await getSettings();
  const today = todayInZone(cfg.timezone);
  // Same cutoff the slot builder uses, so a day greyed out as "too soon"
  // is exactly a day with no slot past the notice cutoff.
  const cutoff = leadTimeCutoff(cfg.leadDays);
  const earliestDate = dateOfInstant(cutoff, cfg.timezone);

  const candidates: string[] = [];
  const days: DayAvailability[] = [];

  for (let i = 0; i < cfg.bookingWindowDays; i++) {
    const date = addDays(today, i);

    if (date < earliestDate) {
      days.push({ date, available: false, slotCount: 0, reason: "lead-time" });
      continue;
    }
    if (!hoursForDate(cfg, date, location)) {
      days.push({ date, available: false, slotCount: 0, reason: "closed" });
      continue;
    }
    // The cutoff can land mid-day, so a day can be open, free, and still
    // entirely too soon. Label it for what it is rather than "booked".
    const dayEnds = new Date(zonedTimeToISO(date, 24 * 60, cfg.timezone));
    const reason: DayUnavailableReason = dayEnds <= cutoff ? "lead-time" : "booked";
    days.push({ date, available: false, slotCount: 0, reason });
    candidates.push(date);
  }

  const results = await Promise.all(
    candidates.map(async (date) => ({
      date,
      slots: await getAvailableSlots(date, durationMinutes, ignoreBookingId, location),
    })),
  );

  for (const { date, slots } of results) {
    const entry = days.find((d) => d.date === date);
    if (!entry) continue;
    entry.slotCount = slots.length;
    if (slots.length > 0) {
      entry.available = true;
      delete entry.reason;
    }
  }

  return days;
}

