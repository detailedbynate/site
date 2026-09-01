// Time bucketing for every revenue chart. Pure and shared, so the Dashboard
// and Finance can never disagree about which periods they are showing or
// where a given job lands.

export type PeriodUnit = "week" | "month";

export type PeriodBucket = {
  /** Stable identity: "2026-09" for a month, the Monday's date for a week. */
  key: string;
  /** Short axis label. */
  label: string;
  /** Inclusive range, for tooltips and for deciding what falls inside. */
  start: string;
  end: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Noon avoids every DST edge — the clock never shifts across midday. */
const at = (date: string) => new Date(`${date}T12:00:00`);

/** The Monday on or before `date`. Weeks run Monday–Sunday. */
export function weekStart(date: string): string {
  const d = at(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}

/** Which bucket a YYYY-MM-DD belongs to, for a given unit. */
export function periodKey(date: string, unit: PeriodUnit): string {
  return unit === "month" ? date.slice(0, 7) : weekStart(date);
}

/**
 * Build `count` buckets, oldest first, ending at the current period — or at
 * the latest period that actually contains data, whichever is later.
 *
 * That second half matters: revenue is counted by the date a job is booked
 * for, not the day it was marked complete. Finishing a job dated a few days
 * out used to drop its revenue into a bucket the chart didn't draw, so the
 * money existed and the graph didn't move. Near a period boundary that's
 * routine, since people book ahead.
 *
 * Nothing is cached or scheduled: `today` is resolved from the business
 * timezone per request, so the window rolls over on its own.
 */
export function buildPeriodWindow(
  today: string,
  unit: PeriodUnit,
  count: number,
  dataDates: string[] = [],
): PeriodBucket[] {
  const current = periodKey(today, unit);
  const latest = dataDates.reduce(
    (max, d) => (periodKey(d, unit) > max ? periodKey(d, unit) : max),
    current,
  );

  const buckets: PeriodBucket[] = [];

  if (unit === "month") {
    const [y, m] = latest.split("-").map(Number);
    const end = new Date(y, m - 1, 1);
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      buckets.push({
        key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
        label: d.toLocaleString("en-US", { month: "short" }),
        start: iso(d),
        end: iso(last),
      });
    }
    return buckets;
  }

  const end = at(latest);
  for (let i = count - 1; i >= 0; i--) {
    const start = at(latest);
    start.setDate(end.getDate() - i * 7);
    const finish = new Date(start);
    finish.setDate(start.getDate() + 6);
    buckets.push({
      key: iso(start),
      label: start.toLocaleString("en-US", { month: "short", day: "numeric" }),
      start: iso(start),
      end: iso(finish),
    });
  }
  return buckets;
}

/** "1–7 Sep" style range, for a tooltip. */
export function periodRangeLabel(bucket: PeriodBucket, unit: PeriodUnit): string {
  if (unit === "month") {
    return at(bucket.start).toLocaleString("en-US", { month: "long", year: "numeric" });
  }
  const s = at(bucket.start);
  const e = at(bucket.end);
  const sameMonth = s.getMonth() === e.getMonth();
  const left = s.toLocaleString("en-US", { month: "short", day: "numeric" });
  const right = e.toLocaleString("en-US", sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${left} – ${right}`;
}
