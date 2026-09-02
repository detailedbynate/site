import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Ban, X } from "lucide-react";

import {
  getCalendarEvents,
  listAppointments,
  listTimeOffEntries,
  removeTimeOff,
  saveTimeOff,
} from "@/lib/api/admin.functions";
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
type GEvent = Awaited<ReturnType<typeof getCalendarEvents>>["events"][number];
type TimeOffEntry = Awaited<ReturnType<typeof listTimeOffEntries>>["entries"][number];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Local time-of-day for an instant, e.g. "9:30 AM". All-day events have none. */
function eventTime(e: GEvent): string {
  if (e.allDay) return "All day";
  return new Date(e.startISO).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function CalendarPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState<string | null>(null);

  // Google's side of the month, loaded separately: it changes when you page
  // between months, and it must never take the page down if Google is off.
  const [gcal, setGcal] = useState<{ connected: boolean; events: GEvent[] }>({
    connected: false,
    events: [],
  });

  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const loadTimeOff = useCallback(() => {
    listTimeOffEntries()
      .then((r) => setTimeOff(r.entries))
      .catch(() => setTimeOff([]));
  }, []);

  useEffect(loadTimeOff, [loadTimeOff]);

  useEffect(() => {
    listAppointments()
      .then((r) => setRows(r.bookings))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const from = iso(year, month, 1);
    const nextMonth = new Date(year, month + 1, 1);
    const to = iso(nextMonth.getFullYear(), nextMonth.getMonth(), 1);

    getCalendarEvents({ data: { from, to } })
      .then((r) => !cancelled && setGcal({ connected: r.connected, events: r.events }))
      .catch(() => !cancelled && setGcal({ connected: false, events: [] }));
    return () => {
      cancelled = true;
    };
  }, [year, month]);

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

  // Google events, grouped the same way. Events the site itself wrote for a
  // booking are dropped — they'd otherwise show twice on the same day, once
  // as the job and once as its calendar copy.
  const eventsByDate = useMemo(() => {
    const ours = new Set(
      (rows ?? []).map((b) => b.googleEventId).filter((id): id is string => Boolean(id)),
    );
    const map = new Map<string, GEvent[]>();
    for (const e of gcal.events) {
      if (ours.has(e.id)) continue;
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startISO.localeCompare(b.startISO));
    }
    return map;
  }, [gcal.events, rows]);

  /** Blocks covering a given day. */
  const offFor = useCallback(
    (date: string) => timeOff.filter((t) => t.startDate <= date && t.endDate >= date),
    [timeOff],
  );

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

  const selectedJobs = selected ? (byDate.get(selected) ?? []) : [];
  const selectedEvents = selected ? (eventsByDate.get(selected) ?? []) : [];
  const selectedOff = selected ? offFor(selected) : [];

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Every booked job at a glance. Tap a day to see the schedule."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => shift(-1)} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[124px] text-center font-display text-sm font-semibold text-foreground sm:min-w-[150px]">
              {monthLabel}
            </span>
            <Button size="sm" onClick={() => shift(1)} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <GlassCard className="p-3 sm:p-6">
        <div className="mb-2 grid grid-cols-7 gap-1 sm:mb-3 sm:gap-1.5">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="py-1 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              {/* One letter on a phone — "Wed" in a 44px column wraps. */}
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
          {cells.map((date, i) => {
            if (!date)
              return <div key={`pad-${i}`} className="min-h-[54px] rounded-xl sm:min-h-[92px]" />;
            const list = byDate.get(date) ?? [];
            const events = eventsByDate.get(date) ?? [];
            const isToday = date === todayISO;
            const isSelected = date === selected;
            const revenue = list.reduce((s, b) => s + (b.totalPrice ?? 0), 0);
            const off = offFor(date);
            const blocked = events.some((e) => e.allDay) || off.some((t) => t.allDay);

            return (
              <motion.button
                key={date}
                type="button"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1, transition: { delay: Math.min(i * 0.008, 0.25) } }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setSelected(isSelected ? null : date)}
                className={`flex min-h-[54px] flex-col rounded-xl border p-1 text-left transition-colors sm:min-h-[92px] sm:rounded-2xl sm:p-2 ${
                  isSelected
                    ? "border-primary bg-primary/10"
                    : isToday
                      ? "border-primary/50 bg-card"
                      : blocked
                        ? "border-border bg-[var(--fill-2)]"
                        : "border-border bg-card/50 hover:border-primary/40"
                }`}
              >
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center self-start rounded-md text-[11px] font-bold sm:h-6 sm:w-6 sm:rounded-lg sm:text-xs ${
                    isToday ? "text-primary-foreground" : "text-foreground"
                  }`}
                  style={isToday ? { backgroundImage: "var(--gradient-brand)" } : undefined}
                >
                  {Number(date.slice(-2))}
                </span>

                {/*
                  Phones get dots, not text. Four labels at 10px in a ~44px
                  column is unreadable, and it was the whole reason this grid
                  felt cramped. The day panel below carries the detail.
                */}
                <div className="mt-auto flex flex-wrap gap-0.5 pt-1 sm:hidden">
                  {list.slice(0, 4).map((b) => (
                    <span
                      key={b.id}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundImage: "var(--gradient-brand)" }}
                    />
                  ))}
                  {events.slice(0, 2).map((e) => (
                    <span key={e.id} className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
                  ))}
                  {off.slice(0, 1).map((t) => (
                    <span key={t.id} className="h-1.5 w-1.5 rounded-full bg-amber-400/80" />
                  ))}
                </div>

                <div className="mt-1.5 hidden space-y-1 sm:block">
                  {list.slice(0, 2).map((b) => (
                    <div
                      key={b.id}
                      className="truncate rounded-md bg-secondary/70 px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                      title={`${time12h(b.startTime)} ${b.client?.name ?? ""} — ${b.serviceTitle}`}
                    >
                      {time12h(b.startTime)} {b.client?.name?.split(" ")[0] ?? ""}
                    </div>
                  ))}
                  {off.slice(0, 1).map((t) => (
                    <div
                      key={t.id}
                      className="truncate rounded-md bg-amber-400/12 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
                      title={t.reason || "Time off"}
                    >
                      {t.allDay ? "Time off" : `${time12h(t.startTime)} off`}
                    </div>
                  ))}
                  {/* Google entries: outlined, never filled, so a glance still
                      separates money-making work from everything else. */}
                  {events.slice(0, list.length > 0 ? 1 : 2).map((e) => (
                    <div
                      key={e.id}
                      className="truncate rounded-md border border-[var(--line-2)] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                      title={`${eventTime(e)} — ${e.summary}`}
                    >
                      {e.allDay ? e.summary : `${eventTime(e)} ${e.summary}`}
                    </div>
                  ))}
                  {list.length + events.length > 2 && (
                    <div className="px-1.5 text-[10px] font-semibold text-primary">
                      +{list.length + events.length - 2} more
                    </div>
                  )}
                </div>

                {revenue > 0 && (
                  <span className="mt-1 hidden px-1.5 text-[10px] font-semibold text-muted-foreground sm:block">
                    {money(revenue)}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundImage: "var(--gradient-brand)" }}
              />
              Booked job
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-muted-foreground/70" />
              {gcal.connected ? "From Google Calendar" : "Google Calendar not connected"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400/80" />
              Time off
            </span>
          </div>
          <p className="tnum text-xs text-muted-foreground">
            {monthLabel} booked value:{" "}
            <span className="font-semibold text-foreground">{money(monthTotal)}</span>
          </p>
        </div>
      </GlassCard>

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-5 overflow-hidden"
          >
            <GlassCard className="p-4 sm:p-6">
              <p className="text-[15px] font-semibold tracking-tight text-foreground">
                {new Date(`${selected}T12:00:00`).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>

              {selectedJobs.length === 0 && selectedEvents.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {selectedOff.length ? "No jobs booked." : "Nothing on this day."}
                </p>
              ) : (
                <ul className="mt-4 space-y-2.5">
                  {selectedJobs.map((b, i) => (
                    <motion.li
                      key={b.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0, transition: { delay: i * 0.05 } }}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-border bg-card/60 px-3 py-3 sm:px-4"
                    >
                      <span className="text-[13px] font-bold text-primary">
                        {time12h(b.startTime)}
                      </span>
                      <div className="min-w-0 flex-1 basis-full sm:basis-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {b.client?.name} — {b.serviceTitle}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {hours(b.durationMinutes)} ·{" "}
                          {b.location === "mobile" ? b.address : "At the shop"}
                        </p>
                      </div>
                      <span className="text-[13px] font-bold">{money(b.totalPrice ?? 0)}</span>
                      <StatusPill status={b.status} />
                    </motion.li>
                  ))}

                  {selectedEvents.map((e, i) => (
                    <motion.li
                      key={e.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{
                        opacity: 1,
                        x: 0,
                        transition: { delay: (selectedJobs.length + i) * 0.05 },
                      }}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-dashed border-[var(--line-2)] px-3 py-3 sm:px-4"
                    >
                      <span className="text-[13px] font-semibold text-muted-foreground">
                        {eventTime(e)}
                      </span>
                      <div className="min-w-0 flex-1 basis-full sm:basis-0">
                        <p className="truncate text-sm font-medium text-foreground">{e.summary}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {e.location || "From your Google Calendar"}
                        </p>
                      </div>
                      {e.free && !e.allDay ? (
                        <span className="rounded-md bg-[var(--fill-2)] px-2 py-1 text-[10.5px] font-semibold text-muted-foreground">
                          Free — still bookable
                        </span>
                      ) : (
                        <span className="rounded-md bg-[var(--fill-2)] px-2 py-1 text-[10.5px] font-semibold text-muted-foreground">
                          Blocks booking
                        </span>
                      )}
                      {e.htmlLink && (
                        <a
                          href={e.htmlLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground transition-colors hover:text-foreground"
                          aria-label="Open in Google Calendar"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </motion.li>
                  ))}
                </ul>
              )}

              {/*
                Blocking time lives here rather than in Settings because this
                is the page you are on when you realise you need the day. It
                is also the only way to be unavailable without Google — the
                calendar used to be the sole mechanism, which was no use to
                anyone who hadn't connected it.
              */}
              <div className="mt-5 border-t border-[var(--line-1)] pt-4">
                {selectedOff.length > 0 ? (
                  <ul className="space-y-2">
                    {selectedOff.map((t) => (
                      <li
                        key={t.id}
                        className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-400/[0.08] px-3 py-2.5"
                      >
                        <Ban className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                        <span className="text-[12.5px] font-semibold text-amber-200">
                          {t.allDay
                            ? "Unavailable all day"
                            : `Unavailable ${time12h(t.startTime)}–${time12h(t.endTime)}`}
                        </span>
                        {t.startDate !== t.endDate && (
                          <span className="text-[11.5px] text-muted-foreground">
                            {t.startDate} → {t.endDate}
                          </span>
                        )}
                        {t.reason && (
                          <span className="text-[11.5px] text-muted-foreground">· {t.reason}</span>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await removeTimeOff({ data: { id: t.id } });
                              loadTimeOff();
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" /> Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await saveTimeOff({
                          data: {
                            startDate: selected,
                            endDate: selected,
                            allDay: true,
                            reason: "",
                          },
                        });
                        loadTimeOff();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Ban className="h-3.5 w-3.5" /> Block this day off
                  </Button>
                )}
                {selectedJobs.length > 0 && selectedOff.length > 0 && (
                  <p className="mt-2 text-[11.5px] text-muted-foreground">
                    Blocking stops new bookings. The {selectedJobs.length} job
                    {selectedJobs.length === 1 ? "" : "s"} already booked stay put — cancel
                    {selectedJobs.length === 1 ? " it" : " them"} from Appointments if you need to.
                  </p>
                )}
              </div>

              {!gcal.connected && (
                <p className="mt-4 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Connect Google Calendar under Integrations to see your other commitments here.
                </p>
              )}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
