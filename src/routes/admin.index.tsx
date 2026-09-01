import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowUpRight,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  DollarSign,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

import { getDashboard } from "@/lib/api/admin.functions";
import { TabBar } from "@/components/admin/TabBar";
import {
  ChartModeToggle,
  RevenueChart,
  type ChartMode,
} from "@/components/admin/RevenueChart";
import {
  EmptyState,
  ErrorNote,
  GlassCard,
  PageHeader,
  Spinner,
  StatTile,
  StatusPill,
  money,
  prettyDate,
  time12h,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/")({
  component: Dashboard,
});

type Data = Awaited<ReturnType<typeof getDashboard>>;

function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unit, setUnit] = useState<"week" | "month">("month");
  const [count, setCount] = useState(6);
  const [chartMode, setChartMode] = useState<ChartMode>("bars");

  useEffect(() => {
    let cancelled = false;
    getDashboard({ data: { unit, count } })
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load."));
    return () => {
      cancelled = true;
    };
  }, [unit, count]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Loading dashboard…" />;

  const { stats, today, upcoming, months, byService } = data;
  const hasBooked = months.some((m) => m.booked > 0);

  // Month-on-month pace. Both figures come from the server as real calendar
  // months, never from the chart buckets — the chart can be showing weeks,
  // and it may extend past today for future-dated work, so reading it
  // positionally gave the wrong answer in both cases.
  const thisMonthRevenue = stats.revenueThisMonth;
  const lastMonthRevenue = stats.revenueLastMonth;
  const pacePercent =
    lastMonthRevenue > 0
      ? Math.round((thisMonthRevenue / lastMonthRevenue) * 100)
      : thisMonthRevenue > 0
        ? 100
        : 0;

  // A plain-English read, chosen from what's actually true right now rather
  // than a generic greeting.
  const { headline, subline } = (() => {
    if (stats.todayCount > 0) {
      return {
        headline: `${stats.todayCount} ${stats.todayCount === 1 ? "job" : "jobs"} on today.`,
        subline:
          stats.upcomingCount > 0
            ? `${stats.upcomingCount} more booked after that, worth ${money(stats.pipeline)}.`
            : "Nothing else booked yet this week.",
      };
    }
    if (lastMonthRevenue > 0 && thisMonthRevenue > lastMonthRevenue) {
      return {
        headline: `You're ahead of last month by ${money(thisMonthRevenue - lastMonthRevenue)}.`,
        subline: `${money(thisMonthRevenue)} earned so far, with ${money(stats.pipeline)} still booked in.`,
      };
    }
    if (stats.upcomingCount > 0) {
      return {
        headline: `${stats.upcomingCount} ${stats.upcomingCount === 1 ? "job" : "jobs"} booked in.`,
        subline: `That's ${money(stats.pipeline)} of work waiting, and ${money(stats.revenueThisMonth)} earned this month.`,
      };
    }
    // Nothing upcoming — but "no jobs booked yet" would be a lie if work has
    // already been completed, so lead with that instead.
    if (stats.completedAllTime > 0) {
      return {
        headline: "Nothing booked in right now.",
        subline: `${stats.completedAllTime} job${stats.completedAllTime === 1 ? "" : "s"} completed so far${
          stats.aheadRevenue > 0 ? `, including ${money(stats.aheadRevenue)} dated next month` : ""
        }.`,
      };
    }
    return {
      headline: "No jobs booked yet.",
      subline: "Bookings from the site land here automatically, the moment someone books.",
    };
  })();

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="How the shop is doing right now."
        actions={
          <Link
            to="/admin/appointments"
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            style={{ backgroundImage: "var(--gradient-brand)" }}
          >
            All appointments <ArrowUpRight className="h-4 w-4" />
          </Link>
        }
      />

      {/* Hero row: a plain-English read on the month, and how it compares. */}
      <div className="mb-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden rounded-2xl p-6 text-primary-foreground"
          style={{ backgroundImage: "var(--gradient-brand)" }}
        >
          {/* Decorative wash. `clip` not `hidden` — see styles.css. */}
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/20 blur-[70px]" />
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-black/15 px-2.5 py-1.5 text-[11px] font-semibold backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5" /> This month
          </span>
          <p className="mt-5 max-w-md text-[22px] font-bold leading-snug tracking-tight">
            {headline}
          </p>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed opacity-85">{subline}</p>
          <Link
            to="/admin/finance"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-black/20 px-3.5 py-2 text-[12.5px] font-semibold backdrop-blur-sm transition hover:bg-black/30"
          >
            See the numbers <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </motion.div>

        <GlassCard index={1} className="flex flex-col items-center justify-center p-6">
          <p className="self-start text-[15px] font-semibold tracking-tight text-foreground">
            Against last month
          </p>
          <Gauge percent={pacePercent} />
          <div className="mt-4 flex w-full items-center justify-between text-[11.5px]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundImage: "var(--gradient-brand)" }}
              />
              This month {money(thisMonthRevenue)}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-[var(--fill-3)]" />
              Last {money(lastMonthRevenue)}
            </span>
          </div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          index={0}
          label="Today"
          value={stats.todayCount}
          hint={stats.todayCount === 1 ? "job booked" : "jobs booked"}
          icon={CalendarCheck}
          accent
        />
        <StatTile
          index={1}
          label="Upcoming"
          value={stats.upcomingCount}
          hint={`${money(stats.pipeline)} in the pipeline`}
          icon={CalendarClock}
        />
        <StatTile
          index={2}
          label="Revenue this month"
          value={money(stats.revenueThisMonth)}
          hint={
            // Revenue is counted by the job's own date, so a completed job
            // dated next month isn't "this month" — say so, rather than
            // leaving someone staring at $0 after finishing a job.
            stats.aheadRevenue > 0
              ? `+ ${money(stats.aheadRevenue)} completed, dated next month`
              : "from completed jobs"
          }
          icon={DollarSign}
        />
        <StatTile
          index={3}
          label="Customers"
          value={stats.totalClients}
          hint={`${stats.completedAllTime} details completed`}
          icon={Users}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        {/* Revenue chart */}
        <GlassCard index={4} className="p-4 sm:p-6 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[15px] font-semibold tracking-tight text-foreground">Revenue</p>
              <p className="text-xs text-muted-foreground">
                Completed jobs, last {count} {unit === "week" ? "weeks" : "months"}
                {hasBooked && " · dashed is booked but not done"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TabBar
                layoutId="dash-unit"
                size="sm"
                value={unit}
                onChange={(u) => {
                  setUnit(u);
                  // A sensible span for each: 8 weeks or 6 months.
                  setCount(u === "week" ? 8 : 6);
                }}
                tabs={[
                  { value: "week" as const, label: "Weekly" },
                  { value: "month" as const, label: "Monthly" },
                ]}
              />
              <ChartModeToggle mode={chartMode} onChange={setChartMode} />
            </div>
          </div>

          <div className="mt-7">
            <RevenueChart
              data={months.map((m) => ({
                key: m.month,
                label: m.label,
                revenue: m.revenue,
                booked: m.booked,
                jobs: m.jobs,
                bookedJobs: m.bookedJobs,
                start: m.start,
                end: m.end,
              }))}
              mode={chartMode}
            />
          </div>

          {months.every((m) => m.revenue === 0) && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              No completed jobs in this range — mark an appointment complete and it'll show up here.
            </p>
          )}
        </GlassCard>

        {/* Package mix */}
        <GlassCard index={5} className="p-6">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Package mix</p>
          <p className="text-xs text-muted-foreground">Which services sell</p>

          <div className="mt-5 space-y-4">
            {byService.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing booked yet.</p>
            )}
            {byService.map((s, i) => {
              const max = Math.max(...byService.map((x) => x.revenue), 1);
              return (
                <div key={s.title}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{s.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.count} · {money(s.revenue)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(s.revenue / max) * 100}%` }}
                      transition={{ delay: 0.25 + i * 0.08, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                      className="h-full rounded-full"
                      style={{ backgroundImage: "var(--gradient-brand)" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <GlassCard index={6} className="p-6">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Today's schedule</p>
          {today.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nothing booked today.</p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {today.map((b, i) => (
                <motion.li
                  key={b.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0, transition: { delay: i * 0.06 } }}
                  className="flex items-center gap-3 rounded-xl border border-[var(--line-1)] bg-[var(--fill-1)] px-3.5 py-2.5"
                >
                  <span className="text-[13px] font-bold text-primary">
                    {time12h(b.startTime)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {b.client?.name ?? "—"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {b.serviceTitle} · {b.location === "mobile" ? "Mobile" : "Shop"}
                    </p>
                  </div>
                  <StatusPill status={b.status} />
                </motion.li>
              ))}
            </ul>
          )}
        </GlassCard>

        <GlassCard index={7} className="p-6">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Coming up</p>
          {upcoming.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                icon={CheckCircle2}
                title="All clear"
                body="No upcoming appointments on the books."
              />
            </div>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {upcoming.map((b, i) => (
                <motion.li
                  key={b.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0, transition: { delay: i * 0.05 } }}
                  className="flex items-center gap-3 rounded-xl border border-[var(--line-1)] bg-[var(--fill-1)] px-3.5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {b.client?.name ?? "—"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {prettyDate(b.date)} · {time12h(b.startTime)} · {b.serviceTitle}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-bold text-foreground">
                    {money(b.totalPrice ?? 0)}
                  </span>
                </motion.li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>
    </>
  );
}


/**
 * Semicircular progress arc, as in the reference dashboard.
 *
 * Drawn with two stroked SVG arcs rather than a chart library: the track, and
 * the value on top, revealed with stroke-dashoffset. Capped at 100% so a
 * blowout month cannot draw past the end of the arc.
 */
function Gauge({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  // Semicircle of radius 80, so the drawn length is pi * r.
  const length = Math.PI * 80;
  const offset = length * (1 - clamped / 100);

  return (
    <div className="relative mt-4 w-full max-w-[220px]">
      <svg viewBox="0 0 200 110" className="w-full">
        <defs>
          <linearGradient id="gaugeFill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--primary-glow)" />
          </linearGradient>
        </defs>
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke="var(--fill-3)"
          strokeWidth="16"
          strokeLinecap="round"
        />
        <motion.path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke="url(#gaugeFill)"
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={length}
          initial={{ strokeDashoffset: length }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="text-[11px] font-medium text-muted-foreground">of last month</p>
        <motion.p
          key={clamped}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="tnum text-[26px] font-bold leading-none tracking-tight text-foreground"
        >
          {percent}%
        </motion.p>
      </div>
    </div>
  );
}
