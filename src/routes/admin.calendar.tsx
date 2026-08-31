import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { listAppointments } from "@/lib/api/admin.functions";
import {
  ErrorNote,
  GlassCard,
  PageHeader,
  Spinner,
  StatusPill,
  Button,
  money,
  time12h,
  hours,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/calendar")({
  component: CalendarPage,
});

type Row = Awaited<ReturnType<typeof listAppointments>>["bookings"][number];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function CalendarPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    listAppointments()
      .then((r) => setRows(r.bookings))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
  }, []);

  // Group active bookings by date once, so each cell is a cheap lookup.
  const byDate = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const b of rows ?? []) {
      if (b.status === "cancelled") continue;
      const list = map.get(b.date) ?? [];
      list.push(b);
      map.set(b.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [rows]);

  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lead = first.getDay();
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(iso(year, month, d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [year, month]);

  const shift = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelected(null);
  };

  const todayISO = iso(now.getFullYear(), now.getMonth(), now.getDate());
  const monthLabel = new Date(year, month, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!rows) return <Spinner label="Loading calendar…" />;

  const monthTotal = [...byDate.entries()]
    .filter(([d]) => d.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`))
    .reduce((sum, [, list]) => sum + list.reduce((s, b) => s + (b.totalPrice ?? 0), 0), 0);

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Every booked job at a glance. Click a day to see the schedule."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => shift(-1)} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[150px] text-center font-display text-sm font-semibold text-foreground">
              {monthLabel}
            </span>
            <Button size="sm" onClick={() => shift(1)} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <GlassCard className="p-4 sm:p-6">
        <div className="mb-3 grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="py-1 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((date, i) => {
            if (!date) return <div key={`pad-${i}`} className="min-h-[92px] rounded-2xl" />;
            const list = byDate.get(date) ?? [];
            const isToday = date === todayISO;
            const isSelected = date === selected;
            const revenue = list.reduce((s, b) => s + (b.totalPrice ?? 0), 0);

            return (
              <motion.button
                key={date}
                type="button"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1, transition: { delay: Math.min(i * 0.008, 0.25) } }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setSelected(isSelected ? null : date)}
                className={`min-h-[92px] rounded-2xl border p-2 text-left transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/10"
                    : isToday
                      ? "border-primary/50 bg-card"
                      : "border-border bg-card/50 hover:border-primary/40"
                }`}
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold ${
                    isToday ? "text-primary-foreground" : "text-foreground"
                  }`}
                  style={isToday ? { backgroundImage: "var(--gradient-brand)" } : undefined}
                >
                  {Number(date.slice(-2))}
                </span>

                <div className="mt-1.5 space-y-1">
                  {list.slice(0, 2).map((b) => (
                    <div
                      key={b.id}
                      className="truncate rounded-md bg-secondary/70 px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                      title={`${time12h(b.startTime)} ${b.client?.name ?? ""} — ${b.serviceTitle}`}
                    >
                      {time12h(b.startTime)} {b.client?.name?.split(" ")[0] ?? ""}
                    </div>
                  ))}
                  {list.length > 2 && (
                    <div className="px-1.5 text-[10px] font-semibold text-primary">
                      +{list.length - 2} more
                    </div>
                  )}
                </div>

                {revenue > 0 && (
                  <span className="mt-1 block px-1.5 text-[10px] font-semibold text-muted-foreground">
                    {money(revenue)}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>

        <p className="tnum mt-4 text-right text-xs text-muted-foreground">
          {monthLabel} booked value:{" "}
          <span className="font-semibold text-foreground">{money(monthTotal)}</span>
        </p>
      </GlassCard>

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-5 overflow-hidden"
          >
            <GlassCard className="p-6">
              <p className="text-[15px] font-semibold tracking-tight text-foreground">
                {new Date(`${selected}T12:00:00`).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>
              {(byDate.get(selected) ?? []).length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Nothing booked this day.</p>
              ) : (
                <ul className="mt-4 space-y-2.5">
                  {(byDate.get(selected) ?? []).map((b, i) => (
                    <motion.li
                      key={b.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0, transition: { delay: i * 0.05 } }}
                      className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/60 px-4 py-3"
                    >
                      <span className="text-[13px] font-bold text-primary">
                        {time12h(b.startTime)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {b.client?.name} — {b.serviceTitle}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {hours(b.durationMinutes)} ·{" "}
                          {b.location === "mobile" ? b.address : "At the shop"}
                        </p>
                      </div>
                      <span className="text-[13px] font-bold">
                        {money(b.totalPrice ?? 0)}
                      </span>
                      <StatusPill status={b.status} />
                    </motion.li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
