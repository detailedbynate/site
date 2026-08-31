import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowUpRight,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  DollarSign,
  TrendingUp,
  Users,
} from "lucide-react";

import { getDashboard } from "@/lib/api/admin.functions";
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

  useEffect(() => {
    let cancelled = false;
    getDashboard()
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load."));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Loading dashboard…" />;

  const { stats, today, upcoming, months, byService } = data;
  const peak = Math.max(1, ...months.map((m) => m.revenue));

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          hint="from completed jobs"
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
        <GlassCard index={4} className="p-6 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[15px] font-semibold tracking-tight text-foreground">Revenue</p>
              <p className="text-xs text-muted-foreground">Completed jobs, last 6 months</p>
            </div>
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>

          <div className="mt-8 flex h-52 items-end gap-3">
            {months.map((m, i) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-2">
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: `${(m.revenue / peak) * 100}%`, opacity: 1 }}
                  transition={{ delay: 0.15 + i * 0.07, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  className="relative w-full rounded-t-xl"
                  style={{
                    backgroundImage: "var(--gradient-brand)",
                    minHeight: m.revenue > 0 ? 6 : 2,
                    opacity: m.revenue > 0 ? 1 : 0.25,
                  }}
                  title={`${money(m.revenue)} · ${m.jobs} job(s)`}
                />
                <span className="text-[11px] font-medium text-muted-foreground">{m.label}</span>
              </div>
            ))}
          </div>
          {peak === 1 && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              No completed jobs yet — mark an appointment complete and it'll show up here.
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
                  className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5"
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
                  className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5"
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
