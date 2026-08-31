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
  const earliest = addDays(today, cfg.leadDays);
  const latest = addDays(today, Math.max(cfg.bookingWindowDays - 1, 0));
  if (date < earliest || date > latest) return [];

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

  const busyRangesMin: TimeRange[] = [
    ...googleBusy.map((b) => ({
      startMinutes: minutesFromZonedISO(b.start, cfg.timezone),
      endMinutes: minutesFromZonedISO(b.end, cfg.timezone),
    })),
    ...localBookings
      .filter((b) => b.id !== ignoreBookingId)
      .map((b) => ({
        startMinutes: timeToMinutes(b.startTime),
        endMinutes: timeToMinutes(b.startTime) + b.durationMinutes,
      })),
  ];

  const slots: SlotResult[] = [];
  const now = new Date();
  const isToday = new Date(dayStartISO).toDateString() === new Date().toDateString();

  for (let start = openMin; start + durationMinutes <= closeMin; start += step) {
    const end = start + durationMinutes;
    const overlaps = busyRangesMin.some((r) => start < r.endMinutes && end > r.startMinutes);
    if (overlaps) continue;

    const startISO = zonedTimeToISO(date, start, cfg.timezone);
    if (isToday && new Date(startISO) < now) continue;

    slots.push({
      startTime: minutesToTime(start),
      startISO,
      endISO: zonedTimeToISO(date, end, cfg.timezone),
    });
  }

  return slots;
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

  const candidates: string[] = [];
  const days: DayAvailability[] = [];

  for (let i = 0; i < cfg.bookingWindowDays; i++) {
    const date = addDays(today, i);

    if (i < cfg.leadDays) {
      days.push({ date, available: false, slotCount: 0, reason: "lead-time" });
      continue;
    }
    if (!hoursForDate(cfg, date, location)) {
      days.push({ date, available: false, slotCount: 0, reason: "closed" });
      continue;
    }
    days.push({ date, available: false, slotCount: 0, reason: "booked" });
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

function minutesFromZonedISO(iso: string, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(iso)).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return Number(parts.hour) * 60 + Number(parts.minute);
}
