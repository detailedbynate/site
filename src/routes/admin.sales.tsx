import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  DollarSign,
  Repeat,
  Truck,
  Wallet,
} from "lucide-react";

import { getSales } from "@/lib/api/admin.functions";
import {
  Button,
  ErrorNote,
  GlassCard,
  PageHeader,
  Spinner,
  StatTile,
  money,
  prettyDate,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/sales")({
  component: Sales,
});

type Data = Awaited<ReturnType<typeof getSales>>;

function Sales() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState(12);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    getSales({ data: { months } })
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load."));
    return () => {
      cancelled = true;
    };
  }, [months]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Crunching sales…" />;

  const { totals, byService, byAddOn, topCustomers, recent } = data;
  const peak = Math.max(1, ...data.months.map((m) => m.revenue));

  const exportCsv = () => {
    const rows = [
      ["Month", "Revenue", "Tips", "Jobs"],
      ...data.months.map((m) => [m.key, String(m.revenue), String(m.tips), String(m.jobs)]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Sales"
        subtitle="Revenue is counted on completed jobs only — confirmed work is shown separately as pipeline."
        actions={
          <div className="flex items-center gap-2">
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-3 py-2 text-[13px] font-semibold text-foreground outline-none focus:border-primary/60"
            >
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
              <option value={24}>Last 24 months</option>
            </select>
            <Button onClick={exportCsv}>Export CSV</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          index={0}
          label="This month"
          value={money(totals.mtd)}
          hint={
            totals.momChange === null
              ? "no prior month to compare"
              : `${totals.momChange >= 0 ? "+" : ""}${totals.momChange}% vs last month`
          }
          icon={DollarSign}
          accent
        />
        <StatTile
          index={1}
          label="All-time revenue"
          value={money(totals.revenue)}
          hint={`${totals.jobs} completed · ${money(totals.avgJob)} avg`}
          icon={Wallet}
        />
        <StatTile
          index={2}
          label="Pipeline"
          value={money(totals.pipeline)}
          hint={`${totals.pipelineJobs} booked, not yet done`}
          icon={CalendarClock}
        />
        <StatTile
          index={3}
          label="Outstanding"
          value={money(totals.outstanding)}
          hint="invoiced but unpaid"
          icon={Banknote}
        />
      </div>

      {/* Revenue chart */}
      <GlassCard index={4} className="mt-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-foreground">
              Revenue over time
            </p>
            <p className="text-xs text-muted-foreground">
              Tips included · hover a bar for the detail
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-sm"
                style={{ backgroundImage: "var(--gradient-brand)" }}
              />
              Revenue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-emerald-400/70" />
              Tips
            </span>
          </div>
        </div>

        {/* items-stretch: with items-end the columns size to content and the
            bars' percentage heights collapse. */}
        <div className="mt-8 flex h-56 items-stretch gap-1.5">
          {data.months.map((m, i) => (
            <div key={m.key} className="group relative flex flex-1 flex-col items-center gap-2">
              <div className="relative flex w-full flex-1 items-end">
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${(m.revenue / peak) * 100}%` }}
                  transition={{ delay: 0.05 + i * 0.03, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className="relative w-full rounded-t-md"
                  style={{
                    backgroundImage: "var(--gradient-brand)",
                    minHeight: m.revenue > 0 ? 4 : 2,
                    opacity: m.revenue > 0 ? 1 : 0.2,
                  }}
                >
                  {m.tips > 0 && (
                    <div
                      className="absolute inset-x-0 top-0 rounded-t-md bg-emerald-400/70"
                      style={{ height: `${(m.tips / Math.max(m.revenue, 1)) * 100}%` }}
                    />
                  )}
                </motion.div>

                <div className="pointer-events-none absolute -top-1 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-[var(--line-3)] bg-[var(--card)] px-2.5 py-1.5 text-[11px] shadow-lg group-hover:block">
                  <span className="font-semibold text-foreground">{money(m.revenue)}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {m.jobs} job{m.jobs === 1 ? "" : "s"}
                    {m.tips > 0 && ` · ${money(m.tips)} tips`}
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-medium text-muted-foreground">{m.label}</span>
            </div>
          ))}
        </div>
      </GlassCard>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <GlassCard index={5} className="p-6">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">By package</p>
          <div className="mt-5 space-y-4">
            {byService.length === 0 && (
              <p className="text-[13px] text-muted-foreground">No completed jobs yet.</p>
            )}
            {byService.map((s, i) => {
              const max = Math.max(...byService.map((x) => x.revenue), 1);
              return (
                <div key={s.title}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-foreground">{s.title}</span>
                    <span className="tnum text-[12px] text-muted-foreground">
                      {s.jobs} · {money(s.revenue)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--fill-2)]">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(s.revenue / max) * 100}%` }}
                      transition={{ delay: 0.1 + i * 0.06, duration: 0.6 }}
                      className="h-full rounded-full"
                      style={{ backgroundImage: "var(--gradient-brand)" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-7 text-[15px] font-semibold tracking-tight text-foreground">
            Add-on attach rate
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {byAddOn.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">None sold yet.</p>
            ) : (
              byAddOn.map((a) => (
                <span
                  key={a.title}
                  className="rounded-lg bg-[var(--fill-2)] px-2.5 py-1.5 text-[12px] text-foreground ring-1 ring-inset ring-[var(--line-2)]"
                >
                  {a.title}
                  <span className="tnum ml-1.5 font-semibold text-primary">{a.count}</span>
                </span>
              ))
            )}
          </div>
        </GlassCard>

        <GlassCard index={6} className="p-6">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Top customers</p>
          {topCustomers.length === 0 ? (
            <p className="mt-4 text-[13px] text-muted-foreground">No completed jobs yet.</p>
          ) : (
            <div className="mt-4 space-y-1.5">
              {topCustomers.map((c, i) => (
                <div
                  key={c.name + i}
                  className="flex items-center gap-3 rounded-xl border border-[var(--line-1)] bg-[var(--fill-1)] px-3.5 py-2.5"
                >
                  <span className="tnum w-5 text-[12px] font-bold text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                    {c.name}
                  </span>
                  <span className="tnum text-[11.5px] text-muted-foreground">{c.jobs} jobs</span>
                  <span className="tnum text-[13px] font-bold text-foreground">
                    {money(c.spend)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-[var(--line-2)] pt-5">
            <MiniStat icon={Repeat} label="Repeat" value={`${totals.repeatCustomers}`} />
            <MiniStat icon={Truck} label="Mobile" value={`${totals.mobileShare}%`} />
            <MiniStat icon={Banknote} label="Tips" value={money(totals.tips)} />
          </div>
        </GlassCard>
      </div>

      <GlassCard index={7} className="mt-5 p-6">
        <p className="text-[15px] font-semibold tracking-tight text-foreground">Recent sales</p>
        {recent.length === 0 ? (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Nothing completed yet. Mark an appointment complete and it'll appear here.
          </p>
        ) : (
          <div className="mt-4 space-y-1.5">
            {recent.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line-1)] bg-[var(--fill-1)] px-3.5 py-2.5"
              >
                <span className="rounded-md bg-[var(--fill-2)] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {r.reference}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                  {r.client}
                </span>
                <span className="text-[12px] text-muted-foreground">{r.service}</span>
                <span className="text-[11.5px] text-muted-foreground">{prettyDate(r.date)}</span>
                {r.tip > 0 && (
                  <span className="tnum text-[11.5px] text-emerald-300">+{money(r.tip)} tip</span>
                )}
                <span className="tnum text-[13px] font-bold text-foreground">
                  {money(r.total)}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="tnum mt-0.5 text-[16px] font-bold text-foreground">{value}</p>
    </div>
  );
}
