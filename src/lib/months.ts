// Month bucketing for the revenue charts. Pure and shared, so the Dashboard
// and Finance can never disagree about which months they are showing.

export type MonthBucket = { key: string; label: string };

const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Build `count` month buckets, oldest first.
 *
 * The window ends at the CURRENT month or the latest month that actually has
 * data, whichever is later.
 *
 * That second half matters. Revenue is counted by the date the job is booked
 * for, not the day it was marked complete — so finishing a job that's dated a
 * few days into next month used to put its revenue in a bucket the chart
 * didn't draw yet. The money existed, the graph didn't move, and it looked
 * broken. Near a month boundary that is completely routine, since people book
 * a few days out.
 *
 * Nothing is scheduled or cached here: `today` is resolved from the business
 * timezone on every request, so the window rolls over on its own the moment
 * the month changes. There is no cron to run and no restart needed.
 */
export function buildMonthWindow(
  today: string,
  count: number,
  dataDates: string[] = [],
): MonthBucket[] {
  const current = today.slice(0, 7);
  const latest = dataDates.reduce(
    (max, d) => (d.slice(0, 7) > max ? d.slice(0, 7) : max),
    current,
  );

  const [year, month] = latest.split("-").map(Number);
  const end = new Date(year, month - 1, 1);

  const buckets: MonthBucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    buckets.push({ key: keyOf(d), label: d.toLocaleString("en-US", { month: "short" }) });
  }
  return buckets;
}
