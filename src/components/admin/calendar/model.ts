import type {
  getCalendarEvents,
  listAppointments,
  listTimeOffEntries,
} from "@/lib/api/admin.functions";

// --------------------------------------------------------------------------
// Pure calendar maths for /admin/calendar: dates, time-of-day, colours, and
// side-by-side layout of overlapping blocks. No React in here, so the page
// and its pieces all agree on one definition of "where does this job go".
//
// Everything is in the BUSINESS timezone. Bookings already store wall-clock
// date + "HH:MM"; Google events arrive as instants and are converted with
// Intl, so a phone set to another zone still sees the shop's day.
// --------------------------------------------------------------------------

export type Job = Awaited<ReturnType<typeof listAppointments>>["bookings"][number];
export type GEvent = Awaited<ReturnType<typeof getCalendarEvents>>["events"][number];
export type TimeOffEntry = Awaited<ReturnType<typeof listTimeOffEntries>>["entries"][number];

/** Something with a position on a day's timeline, in minutes since midnight. */
export type TimedItem =
  | { kind: "job"; id: string; start: number; end: number; job: Job }
  | { kind: "event"; id: string; start: number; end: number; event: GEvent }
  | { kind: "off"; id: string; start: number; end: number; off: TimeOffEntry };

/** Things that cover the whole day and sit in a strip above the timeline. */
export type AllDayItem =
  | { kind: "event"; id: string; event: GEvent }
  | { kind: "off"; id: string; off: TimeOffEntry };

export type Placed = TimedItem & { lane: number; lanes: number };

// ------------------------------- dates ------------------------------------

export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Noon, so DST shifts can never push a date across midnight. */
export function dateOf(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

export function addDays(iso: string, n: number): string {
  const d = dateOf(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

/** Monday of the week containing `iso`. A detailer's week starts Monday. */
export function startOfWeek(iso: string): string {
  const day = dateOf(iso).getDay(); // 0 = Sunday
  return addDays(iso, -((day + 6) % 7));
}

export function weekOf(iso: string): string[] {
  const mon = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

/** Monday-first grid of whole weeks covering the month of `iso`. */
export function monthGrid(iso: string): string[] {
  const first = `${iso.slice(0, 7)}-01`;
  const d = dateOf(first);
  const last = isoOf(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
  const out: string[] = [];
  for (let day = startOfWeek(first); day <= last || out.length % 7 !== 0; day = addDays(day, 1)) {
    out.push(day);
  }
  return out;
}

/*
  Formatter caches. Building an Intl.DateTimeFormat is one of the slowest
  things in the JS standard library — tenths of a millisecond each — and
  laying out a month used to build one per event per visible day: thousands
  per click once a real Google calendar was connected. Each distinct set of
  options is now built once and reused for the life of the page.
*/
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts);
    fmtCache.set(key, f);
  }
  return f;
}

export function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return formatter("en-US", opts).format(dateOf(iso));
}

/** Wall-clock date and minute of an instant in `timeZone`. */
function zoned(instant: Date, timeZone: string): { date: string; minute: number } {
  const parts = formatter("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  let y = "", mo = "", d = "", h = "0", mi = "0";
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    else if (p.type === "month") mo = p.value;
    else if (p.type === "day") d = p.value;
    else if (p.type === "hour") h = p.value;
    else if (p.type === "minute") mi = p.value;
  }
  return { date: `${y}-${mo}-${d}`, minute: Number(h) * 60 + Number(mi) };
}

/** Today's date and the current minute, on the shop's clock. */
export function nowInZone(timeZone: string): { date: string; minute: number } {
  return zoned(new Date(), timeZone);
}

// --------------------------- time of day ----------------------------------

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** 570 -> "9:30", with the period only when asked: "9:30 AM". */
export function clock(min: number, withPeriod = true): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const base = m ? `${h}:${String(m).padStart(2, "0")}` : `${h}`;
  return withPeriod ? `${base} ${h24 >= 12 ? "PM" : "AM"}` : base;
}

/** "9:30 – 1:30 PM", or "9 AM – 1:30 PM" when the halves differ. */
export function range(start: number, end: number): string {
  const samePeriod = Math.floor(start / 720) === Math.floor(end / 720);
  return `${clock(start, !samePeriod)} – ${clock(end)}`;
}

export function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ------------------------------ colours -----------------------------------

/**
 * One colour per package, so a glance at the day says what kind of work it
 * is. Chosen to stay legible as a 14% tint on both the dark and light admin
 * grounds; the card text itself is always the foreground colour.
 */
export function jobColor(job: Pick<Job, "serviceId" | "serviceTitle">): string {
  const key = `${job.serviceId} ${job.serviceTitle}`.toLowerCase();
  if (key.includes("diamond")) return "oklch(0.66 0.17 255)";
  if (key.includes("gold")) return "oklch(0.76 0.15 75)";
  if (key.includes("silver")) return "oklch(0.7 0.04 240)";
  if (key.includes("ceramic") || key.includes("coat")) return "oklch(0.66 0.18 305)";
  return "oklch(0.7 0.13 170)";
}

export const PACKAGE_LEGEND = [
  { label: "Diamond", color: "oklch(0.66 0.17 255)" },
  { label: "Gold", color: "oklch(0.76 0.15 75)" },
  { label: "Silver", color: "oklch(0.7 0.04 240)" },
  { label: "Ceramic", color: "oklch(0.66 0.18 305)" },
];

/** Customer's car in one line, or "" if none was given. */
export function vehicleLine(job: Job): string {
  const v = job.vehicle;
  if (!v) return "";
  const car = [v.year, v.make, v.model].filter(Boolean).join(" ");
  return car ? car + (v.color ? ` · ${v.color}` : "") : "";
}

// --------------------------- day contents ---------------------------------

export interface DayContents {
  timed: TimedItem[];
  allDay: AllDayItem[];
  jobs: Job[];
}

/**
 * Everything on each of `dates`, split into timeline blocks and all-day strips.
 *
 * One pass over the inputs, not one per day: jobs are bucketed by date and
 * every Google event is converted to the shop's timezone exactly once, then
 * each day only does arithmetic. The old per-day version re-scanned every job
 * and re-converted every event for each of the ~42 days on screen.
 *
 * Google events the site itself created for a booking are dropped — they
 * would otherwise show twice, once as the job and once as its calendar copy.
 */
export function buildContents(
  dates: Iterable<string>,
  jobs: Job[],
  events: GEvent[],
  timeOff: TimeOffEntry[],
  timeZone: string,
): Map<string, DayContents> {
  const out = new Map<string, DayContents>();
  for (const d of dates) out.set(d, { timed: [], allDay: [], jobs: [] });

  const ours = new Set<string>();
  for (const j of jobs) {
    if (j.googleEventId) ours.add(j.googleEventId);
    if (j.status === "cancelled") continue;
    const day = out.get(j.date);
    if (!day) continue;
    day.jobs.push(j);
    const start = toMinutes(j.startTime);
    day.timed.push({ kind: "job", id: j.id, start, end: start + j.durationMinutes, job: j });
  }

  for (const e of events) {
    if (ours.has(e.id)) continue;
    if (e.allDay) {
      // end.date is exclusive, so a one-day event covers only its own date.
      const last = addDays(zoned(new Date(e.endISO), timeZone).date, -1);
      for (const [d, day] of out) {
        if (e.date <= d && d <= last) day.allDay.push({ kind: "event", id: e.id, event: e });
      }
      continue;
    }
    const s = zoned(new Date(e.startISO), timeZone);
    const f = zoned(new Date(e.endISO), timeZone);
    for (const [d, day] of out) {
      if (s.date > d || f.date < d) continue;
      const start = s.date < d ? 0 : s.minute;
      const end = f.date > d ? 24 * 60 : f.minute;
      if (end > start) day.timed.push({ kind: "event", id: e.id, start, end, event: e });
    }
  }

  for (const t of timeOff) {
    for (const [d, day] of out) {
      if (t.startDate > d || t.endDate < d) continue;
      if (t.allDay) day.allDay.push({ kind: "off", id: t.id, off: t });
      else
        day.timed.push({
          kind: "off",
          id: t.id,
          start: toMinutes(t.startTime),
          end: toMinutes(t.endTime),
          off: t,
        });
    }
  }

  for (const day of out.values()) {
    day.jobs.sort((a, b) => a.startTime.localeCompare(b.startTime));
    day.timed.sort((a, b) => a.start - b.start || b.end - a.end);
  }
  return out;
}

/**
 * Give overlapping blocks their own lanes, side by side.
 *
 * Blocks are grouped into clusters that overlap transitively; each cluster
 * is split into as many lanes as its busiest moment needs, and every block
 * takes the first free lane. Two jobs at 10:00 sit half-width next to each
 * other instead of one hiding the other — which is exactly the double-book
 * you most need to see.
 */
export function placeLanes(items: TimedItem[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (item.start >= clusterEnd && cluster.length) flush();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else laneEnds[lane] = item.end;
    cluster.push({ ...item, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return out;
}

export interface Hours {
  open: boolean;
  openHour: number;
  closeHour: number;
}

/**
 * Which hours the grid shows: the business day, stretched to fit anything
 * booked outside it, and never shorter than eight hours so an empty day still
 * reads as a day.
 */
export function visibleHours(schedules: (Hours | undefined)[], items: TimedItem[]): [number, number] {
  let from = 24;
  let to = 0;
  for (const s of schedules) {
    if (!s?.open) continue;
    from = Math.min(from, s.openHour);
    to = Math.max(to, s.closeHour);
  }
  for (const i of items) {
    from = Math.min(from, Math.floor(i.start / 60));
    to = Math.max(to, Math.ceil(i.end / 60));
  }
  if (from >= to) [from, to] = [8, 18];
  while (to - from < 8) {
    if (to < 24) to++;
    if (to - from < 8 && from > 0) from--;
  }
  return [Math.max(0, from), Math.min(24, to)];
}
