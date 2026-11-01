import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { motion } from "motion/react";
import {
  Ban,
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Store,
  X,
} from "lucide-react";

import {
  getAdminSettings,
  getCalendarEvents,
  listAppointments,
  listTimeOffEntries,
  removeTimeOff,
  saveTimeOff,
} from "@/lib/api/admin.functions";
import {
  Button,
  DetailField,
  DetailGroup,
  DetailPanel,
  ErrorNote,
  GlassCard,
  Spinner,
  StatusPill,
  money,
} from "@/components/admin/ui";
import { TabBar } from "@/components/admin/TabBar";
import { AllDayChips, TimeGrid } from "@/components/admin/calendar/TimeGrid";
import {
  PACKAGE_LEGEND,
  addDays,
  clock,
  contentsFor,
  duration,
  fmt,
  jobColor,
  monthGrid,
  nowInZone,
  range,
  toMinutes,
  vehicleLine,
  visibleHours,
  weekOf,
  type DayContents,
  type GEvent,
  type Hours,
  type Job,
  type TimeOffEntry,
} from "@/components/admin/calendar/model";

export const Route = createFileRoute("/admin/calendar")({
  component: CalendarPage,
});

type View = "day" | "week" | "month";
type Settings = Awaited<ReturnType<typeof getAdminSettings>>["settings"];

const VIEW_KEY = "dbn.admin.calendar.view";

function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "day" || v === "week" || v === "month") return v;
  } catch {
    // Private mode or blocked storage — the default is fine.
  }
  return "day";
}

/**
 * The hours a date is open, honouring date ranges (Settings → Availability)
 * the same way availability.server.ts does: a range with its own schedule
 * wins, and with "only in ranges" on, a date outside every range is closed.
 */
function scheduleFor(date: string, s: Settings | null): Hours | undefined {
  if (!s) return undefined;
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const ranges = s.availabilityRanges ?? [];
  const hit = ranges.find((r) => r.start <= date && date <= r.end);
  if (!hit && s.onlyInRanges && ranges.length) return { open: false, openHour: 0, closeHour: 0 };
  const week = hit?.schedule ?? s.weeklySchedule;
  return week?.[weekday];
}

function CalendarPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([]);
  const [gcal, setGcal] = useState<{ connected: boolean; events: GEvent[] }>({
    connected: false,
    events: [],
  });

  const timeZone = settings?.timezone || "America/Toronto";
  const [now, setNow] = useState(() => nowInZone(timeZone));
  const [anchor, setAnchor] = useState(now.date);
  const [view, setViewState] = useState<View>("day");
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);

  // Restored after mount: localStorage doesn't exist during SSR.
  useEffect(() => setViewState(readView()), []);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Not worth surfacing.
    }
  };

  // Keep the "now" line moving, and re-anchor once the shop timezone is known.
  useEffect(() => {
    const tick = () => setNow(nowInZone(timeZone));
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [timeZone]);
  useEffect(() => {
    if (settings) setAnchor(nowInZone(settings.timezone || "America/Toronto").date);
  }, [settings]);

  const loadTimeOff = useCallback(() => {
    listTimeOffEntries()
      .then((r) => setTimeOff(r.entries))
      .catch(() => setTimeOff([]));
  }, []);

  useEffect(() => {
    loadTimeOff();
    listAppointments()
      .then((r) => setJobs(r.bookings))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
    getAdminSettings()
      .then((r) => setSettings(r.settings))
      .catch(() => setSettings(null));
  }, [loadTimeOff]);

  // What's on screen, as a date span.
  const week = useMemo(() => weekOf(anchor), [anchor]);
  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const span = useMemo(() => {
    const all = [...week, ...grid].sort();
    return { from: all[0], to: addDays(all[all.length - 1], 1) };
  }, [week, grid]);

  // Google's side, loaded per span. It must never take the page down.
  useEffect(() => {
    let cancelled = false;
    getCalendarEvents({ data: span })
      .then((r) => !cancelled && setGcal({ connected: r.connected, events: r.events }))
      .catch(() => !cancelled && setGcal({ connected: false, events: [] }));
    return () => {
      cancelled = true;
    };
  }, [span]);

  const contents = useMemo(() => {
    const map = new Map<string, DayContents>();
    if (!jobs) return map;
    for (const d of new Set([...week, ...grid])) {
      map.set(d, contentsFor(d, jobs, gcal.events, timeOff, timeZone));
    }
    return map;
  }, [jobs, gcal.events, timeOff, timeZone, week, grid]);

  const schedules = useMemo(() => {
    const map = new Map<string, Hours | undefined>();
    for (const d of new Set([...week, ...grid])) map.set(d, scheduleFor(d, settings));
    return map;
  }, [week, grid, settings]);

  const step = (dir: 1 | -1) => {
    if (view === "day") setAnchor(addDays(anchor, dir));
    else if (view === "week") setAnchor(addDays(anchor, 7 * dir));
    else {
      const d = new Date(`${anchor.slice(0, 7)}-01T12:00:00`);
      d.setMonth(d.getMonth() + dir);
      setAnchor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
    }
  };

  const blockDay = async (date: string) => {
    setBusy(true);
    try {
      await saveTimeOff({ data: { startDate: date, endDate: date, allDay: true, reason: "" } });
      loadTimeOff();
    } finally {
      setBusy(false);
    }
  };
  const unblock = async (id: string) => {
    setBusy(true);
    try {
      await removeTimeOff({ data: { id } });
      loadTimeOff();
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!jobs) return <Spinner label="Loading calendar…" />;

  const title =
    view === "day"
      ? fmt(anchor, { weekday: "long", month: "long", day: "numeric" })
      : view === "week"
        ? `${fmt(week[0], { month: "short", day: "numeric" })} – ${fmt(week[6], {
            month: week[0].slice(5, 7) === week[6].slice(5, 7) ? undefined : "short",
            day: "numeric",
          })}`
        : fmt(anchor, { month: "long", year: "numeric" });

  const eyebrow =
    view === "day"
      ? anchor === now.date
        ? "Today"
        : anchor === addDays(now.date, 1)
          ? "Tomorrow"
          : anchor === addDays(now.date, -1)
            ? "Yesterday"
            : fmt(anchor, { year: "numeric" })
      : view === "week"
        ? week.includes(now.date)
          ? "This week"
          : fmt(week[0], { year: "numeric" })
        : "Month";

  const showingToday =
    view === "day"
      ? anchor === now.date
      : view === "week"
        ? week.includes(now.date)
        : anchor.slice(0, 7) === now.date.slice(0, 7);

  return (
    <>
      {/* ------------------------------ header ------------------------------ */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4"
      >
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            {eyebrow}
          </p>
          <h1 className="mt-1 truncate text-[26px] font-bold leading-tight tracking-[-0.03em] text-foreground sm:text-[30px]">
            {title}
          </h1>
        </div>

        <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <TabBar
            layoutId="cal-view"
            value={view}
            onChange={setView}
            tabs={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
          />
          <div className="flex items-center gap-1.5">
            {!showingToday && (
              <Button size="sm" variant="outline" onClick={() => setAnchor(now.date)}>
                Today
              </Button>
            )}
            <IconButton label="Previous" onClick={() => step(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </IconButton>
            <IconButton label="Next" onClick={() => step(1)}>
              <ChevronRight className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </motion.header>

      {view !== "month" && (
        <WeekStrip
          days={week}
          selected={view === "day" ? anchor : null}
          today={now.date}
          contents={contents}
          schedules={schedules}
          onPick={(d) => {
            setAnchor(d);
            setView("day");
          }}
        />
      )}

      <motion.div
        key={view}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {view === "day" && (
          <DayView
            date={anchor}
            day={contents.get(anchor)}
            schedule={schedules.get(anchor)}
            now={now}
            busy={busy}
            googleConnected={gcal.connected}
            onJob={setOpenJob}
            onBlock={blockDay}
            onUnblock={unblock}
          />
        )}

        {view === "week" && (
          <WeekView
            days={week}
            contents={contents}
            schedules={schedules}
            now={now}
            onJob={setOpenJob}
            onDay={(d) => {
              setAnchor(d);
              setView("day");
            }}
          />
        )}

        {view === "month" && (
          <MonthView
            anchor={anchor}
            days={grid}
            contents={contents}
            schedules={schedules}
            today={now.date}
            onDay={(d) => {
              setAnchor(d);
              setView("day");
            }}
          />
        )}
      </motion.div>

      <Legend googleConnected={gcal.connected} />

      <JobPanel job={openJob} onClose={() => setOpenJob(null)} />
    </>
  );
}

// ------------------------------- pieces -----------------------------------

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line-2)] bg-[var(--fill-1)] text-foreground transition-colors hover:bg-[var(--fill-3)]"
    >
      {children}
    </motion.button>
  );
}

/** Seven day pills, Monday first. A coloured dot per booked job. */
function WeekStrip({
  days,
  selected,
  today,
  contents,
  schedules,
  onPick,
}: {
  days: string[];
  selected: string | null;
  today: string;
  contents: Map<string, DayContents>;
  schedules: Map<string, Hours | undefined>;
  onPick: (d: string) => void;
}) {
  return (
    <div className="mb-5 grid grid-cols-7 gap-1.5 sm:gap-2.5">
      {days.map((d) => {
        const isSel = d === selected;
        const isToday = d === today;
        const day = contents.get(d);
        const closed = !schedules.get(d)?.open || day?.allDay.some((a) => a.kind === "off");
        return (
          <motion.button
            key={d}
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={() => onPick(d)}
            className={`relative flex flex-col items-center rounded-[18px] border py-2.5 transition-colors sm:rounded-2xl sm:py-3 ${
              isSel
                ? "border-transparent text-primary-foreground shadow-[var(--shadow-glow)]"
                : isToday
                  ? "border-primary/50 bg-primary/[0.06] text-foreground"
                  : "border-[var(--line-2)] bg-[var(--fill-1)] text-foreground hover:bg-[var(--fill-2)]"
            }`}
          >
            {isSel && (
              <motion.span
                layoutId="cal-day-pill"
                className="absolute inset-0 rounded-[inherit]"
                style={{ backgroundImage: "var(--gradient-brand)" }}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
              />
            )}
            <span
              className={`relative text-[10.5px] font-semibold uppercase tracking-[0.08em] sm:text-[11px] ${
                isSel ? "opacity-80" : closed ? "text-muted-foreground/60" : "text-muted-foreground"
              }`}
            >
              {fmt(d, { weekday: "short" })}
            </span>
            <span
              className={`tnum relative mt-0.5 text-[18px] font-bold leading-none sm:text-[20px] ${
                !isSel && closed ? "text-muted-foreground/70" : ""
              }`}
            >
              {Number(d.slice(8))}
            </span>
            <span className="relative mt-1.5 flex h-1.5 items-center gap-0.5">
              {(day?.jobs ?? []).slice(0, 3).map((j) => (
                <span
                  key={j.id}
                  className={`h-1.5 w-1.5 rounded-full ${isSel ? "bg-primary-foreground/80" : "cal-dot"}`}
                  style={{ "--c": jobColor(j) } as CSSProperties}
                />
              ))}
              {(day?.jobs.length ?? 0) > 3 && (
                <span className={`text-[9px] font-bold leading-none ${isSel ? "" : "text-muted-foreground"}`}>
                  +
                </span>
              )}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

/** Open stretches of at least an hour between everything that blocks time. */
function freeGaps(day: DayContents | undefined, s: Hours | undefined): [number, number][] {
  if (!s?.open || day?.allDay.length) return [];
  const blocks = (day?.timed ?? [])
    .filter((t) => t.kind !== "event" || !t.event.free)
    .map((t) => [t.start, t.end] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let cursor = s.openHour * 60;
  for (const [a, b] of blocks) {
    if (a > cursor) gaps.push([cursor, Math.min(a, s.closeHour * 60)]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < s.closeHour * 60) gaps.push([cursor, s.closeHour * 60]);
  return gaps.filter(([a, b]) => b - a >= 60);
}

function DayView({
  date,
  day,
  schedule,
  now,
  busy,
  googleConnected,
  onJob,
  onBlock,
  onUnblock,
}: {
  date: string;
  day: DayContents | undefined;
  schedule: Hours | undefined;
  now: { date: string; minute: number };
  busy: boolean;
  googleConnected: boolean;
  onJob: (j: Job) => void;
  onBlock: (d: string) => void;
  onUnblock: (id: string) => void;
}) {
  const jobs = day?.jobs ?? [];
  const value = jobs.reduce((s, j) => s + (j.totalPrice ?? 0) - (j.discount ?? 0), 0);
  const bookedMin = jobs.reduce((s, j) => s + j.durationMinutes, 0);
  const openMin = schedule?.open ? (schedule.closeHour - schedule.openHour) * 60 : 0;
  const hoursShown = visibleHours([schedule], day?.timed ?? []);
  const gaps = freeGaps(day, schedule);
  const offEntries = (day?.allDay ?? []).filter((a) => a.kind === "off");
  const timedOff = (day?.timed ?? []).filter((t) => t.kind === "off");
  const allOff = [...offEntries.map((o) => o.off), ...timedOff.map((t) => t.off)];

  const stats = [
    { label: "Jobs", value: String(jobs.length) },
    { label: "Booked", value: money(value) },
    {
      label: "Hours",
      value: openMin ? `${duration(bookedMin)} / ${duration(openMin)}` : duration(bookedMin),
    },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        {/* Phone summary: the sidebar's numbers, compressed. */}
        <div className="mb-4 grid grid-cols-3 gap-2 lg:hidden">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-[var(--line-2)] bg-[var(--fill-1)] px-3 py-2.5"
            >
              <p className="text-[10.5px] font-medium text-muted-foreground">{s.label}</p>
              <p className="tnum mt-0.5 truncate text-[14px] font-bold text-foreground">{s.value}</p>
            </div>
          ))}
        </div>

        <GlassCard className="p-3 sm:p-5">
          {day?.allDay.length ? (
            <div className="mb-3 pl-11 sm:pl-14">
              <AllDayChips items={day.allDay} />
            </div>
          ) : null}

          {!schedule?.open && !jobs.length && !(day?.timed.length) ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-[15px] font-semibold text-foreground">Closed</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Not a working day under your current hours.
              </p>
            </div>
          ) : (
            <TimeGrid
              days={[date]}
              contents={new Map([[date, day ?? { timed: [], allDay: [], jobs: [] }]])}
              hours={hoursShown}
              hourHeight={68}
              schedules={new Map([[date, schedule]])}
              today={now.date}
              nowMinute={now.minute}
              onJob={onJob}
            />
          )}
        </GlassCard>
      </div>

      {/* --------------------------- day sidebar --------------------------- */}
      <div className="space-y-4">
        <GlassCard className="hidden p-5 lg:block">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Day at a glance
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="tnum text-[24px] font-bold leading-none text-foreground">{jobs.length}</p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                job{jobs.length === 1 ? "" : "s"}
              </p>
            </div>
            <div>
              <p className="tnum text-[24px] font-bold leading-none text-foreground">{money(value)}</p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">booked value</p>
            </div>
          </div>
          {openMin > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-[11.5px] text-muted-foreground">
                <span>{duration(bookedMin)} booked</span>
                <span>
                  {clock(schedule!.openHour * 60)} – {clock(schedule!.closeHour * 60)}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--fill-3)]">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundImage: "var(--gradient-brand)" }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (bookedMin / openMin) * 100)}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
            </div>
          )}
        </GlassCard>

        <GlassCard className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Free time
          </p>
          {gaps.length ? (
            <ul className="mt-3 space-y-2">
              {gaps.map(([a, b]) => (
                <li
                  key={a}
                  className="flex items-center justify-between rounded-xl border border-dashed border-[var(--line-3)] px-3 py-2.5"
                >
                  <span className="tnum text-[13px] font-semibold text-foreground">{range(a, b)}</span>
                  <span className="tnum text-[11.5px] text-muted-foreground">{duration(b - a)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              {schedule?.open ? "No gaps of an hour or more." : "Closed this day."}
            </p>
          )}
        </GlassCard>

        {/*
          Blocking time lives here, on the day itself, because this is where
          you are when you realise you need it. It is also the only way to be
          unavailable without connecting Google.
        */}
        <GlassCard className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Availability
          </p>
          {allOff.length ? (
            <ul className="mt-3 space-y-2">
              {allOff.map((t) => (
                <li key={t.id} className="cal-off flex items-center gap-2 rounded-xl px-3 py-2.5">
                  <Ban className="cal-off-ink h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="cal-off-ink text-[12.5px] font-semibold">
                      {t.allDay
                        ? "Off all day"
                        : `Off ${clock(toMinutes(t.startTime))} – ${clock(toMinutes(t.endTime))}`}
                    </p>
                    {(t.reason || t.startDate !== t.endDate) && (
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {[t.reason, t.startDate !== t.endDate ? `${t.startDate} → ${t.endDate}` : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onUnblock(t.id)}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-[var(--fill-2)] hover:text-foreground disabled:opacity-50"
                    aria-label="Remove time off"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="mt-2 text-[12.5px] text-muted-foreground">
                {schedule?.open
                  ? `Open ${clock(schedule.openHour * 60)} – ${clock(schedule.closeHour * 60)} for online booking.`
                  : "Closed under your weekly hours."}
              </p>
              {schedule?.open && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  loading={busy}
                  onClick={() => onBlock(date)}
                >
                  <Ban className="h-3.5 w-3.5" /> Block this day off
                </Button>
              )}
            </>
          )}
          {jobs.length > 0 && allOff.length > 0 && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Blocking stops new bookings. Jobs already booked stay put — cancel them from
              Appointments if you need to.
            </p>
          )}
          {!googleConnected && (
            <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Connect Google Calendar under Integrations to see your other commitments here.
            </p>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

function WeekView({
  days,
  contents,
  schedules,
  now,
  onJob,
  onDay,
}: {
  days: string[];
  contents: Map<string, DayContents>;
  schedules: Map<string, Hours | undefined>;
  now: { date: string; minute: number };
  onJob: (j: Job) => void;
  onDay: (d: string) => void;
}) {
  const all = days.flatMap((d) => contents.get(d)?.timed ?? []);
  const hoursShown = visibleHours(
    days.map((d) => schedules.get(d)),
    all,
  );
  const hasAllDay = days.some((d) => contents.get(d)?.allDay.length);
  const total = days
    .flatMap((d) => contents.get(d)?.jobs ?? [])
    .reduce((s, j) => s + (j.totalPrice ?? 0) - (j.discount ?? 0), 0);
  const count = days.reduce((s, d) => s + (contents.get(d)?.jobs.length ?? 0), 0);

  return (
    <>
      <p className="mb-3 text-[12.5px] text-muted-foreground">
        <span className="font-semibold text-foreground">{count}</span> job{count === 1 ? "" : "s"} ·{" "}
        <span className="tnum font-semibold text-foreground">{money(total)}</span> booked this week
      </p>

      {/* Desktop and tablet: a real seven-column time grid. */}
      <GlassCard className="hidden p-4 md:block lg:p-5">
        {hasAllDay && (
          <div className="mb-2 flex">
            <div className="w-14 shrink-0 pt-1 text-right text-[10.5px] text-muted-foreground">
              <span className="pr-3">All day</span>
            </div>
            <div className="grid flex-1 grid-cols-7">
              {days.map((d) => (
                <div key={d} className="min-w-0 px-1">
                  <AllDayChips items={contents.get(d)?.allDay ?? []} compact />
                </div>
              ))}
            </div>
          </div>
        )}
        <TimeGrid
          days={days}
          contents={contents}
          hours={hoursShown}
          hourHeight={56}
          schedules={schedules}
          today={now.date}
          nowMinute={now.minute}
          compact
          onJob={onJob}
        />
      </GlassCard>

      {/* Phones: seven columns would be 40px each. A day-by-day agenda instead. */}
      <div className="space-y-4 md:hidden">
        {days.map((d) => {
          const day = contents.get(d);
          const items = day?.timed ?? [];
          const closed = !schedules.get(d)?.open;
          return (
            <section key={d}>
              <button
                type="button"
                onClick={() => onDay(d)}
                className="mb-2 flex w-full items-baseline justify-between"
              >
                <span
                  className={`text-[13px] font-bold ${d === now.date ? "text-primary" : "text-foreground"}`}
                >
                  {fmt(d, { weekday: "long", month: "short", day: "numeric" })}
                </span>
                <span className="text-[11.5px] text-muted-foreground">
                  {day?.jobs.length
                    ? `${day.jobs.length} job${day.jobs.length === 1 ? "" : "s"}`
                    : day?.allDay.some((a) => a.kind === "off")
                      ? "Off"
                      : closed
                        ? "Closed"
                        : "Open"}
                </span>
              </button>
              {day?.allDay.length ? (
                <div className="mb-2">
                  <AllDayChips items={day.allDay} />
                </div>
              ) : null}
              {items.length ? (
                <ul className="space-y-2">
                  {items.map((t) => (
                    <li key={`${t.kind}-${t.id}`} className="flex gap-3">
                      <div className="tnum w-14 shrink-0 pt-2.5 text-right">
                        <p className="text-[12.5px] font-semibold text-foreground">{clock(t.start, false)}</p>
                        <p className="text-[10.5px] text-muted-foreground">{t.start >= 720 ? "PM" : "AM"}</p>
                      </div>
                      {t.kind === "job" ? (
                        <button
                          type="button"
                          onClick={() => onJob(t.job)}
                          className="cal-job min-w-0 flex-1 rounded-2xl px-3.5 py-3 text-left"
                          style={{ "--c": jobColor(t.job) } as CSSProperties}
                        >
                          <p className="tnum cal-ink text-[11px] font-semibold">{range(t.start, t.end)}</p>
                          <p className="truncate text-[14.5px] font-bold text-foreground">
                            {t.job.client?.name ?? "Client"}
                          </p>
                          <p className="truncate text-[12px] text-muted-foreground">
                            {t.job.serviceTitle}
                            {t.job.location === "mobile" ? ` · ${t.job.address ?? "Mobile"}` : " · Drop-off"}
                          </p>
                        </button>
                      ) : t.kind === "event" ? (
                        <a
                          href={t.event.htmlLink}
                          target="_blank"
                          rel="noreferrer"
                          className="cal-event min-w-0 flex-1 rounded-2xl px-3.5 py-2.5"
                        >
                          <p className="truncate text-[13px] font-semibold text-foreground/85">{t.event.summary}</p>
                          <p className="tnum text-[11px] text-muted-foreground">{range(t.start, t.end)} · Google</p>
                        </a>
                      ) : (
                        <div className="cal-off min-w-0 flex-1 rounded-2xl px-3.5 py-2.5">
                          <p className="cal-off-ink text-[13px] font-semibold">{t.off.reason || "Time off"}</p>
                          <p className="tnum text-[11px] text-muted-foreground">{range(t.start, t.end)}</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                !day?.allDay.length && (
                  <p className="rounded-2xl border border-dashed border-[var(--line-2)] px-4 py-3 text-[12px] text-muted-foreground">
                    {closed ? "Closed" : "Nothing booked"}
                  </p>
                )
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function MonthView({
  anchor,
  days,
  contents,
  schedules,
  today,
  onDay,
}: {
  anchor: string;
  days: string[];
  contents: Map<string, DayContents>;
  schedules: Map<string, Hours | undefined>;
  today: string;
  onDay: (d: string) => void;
}) {
  const month = anchor.slice(0, 7);
  const inMonth = days.filter((d) => d.startsWith(month));
  const jobsInMonth = inMonth.flatMap((d) => contents.get(d)?.jobs ?? []);
  const total = jobsInMonth.reduce((s, j) => s + (j.totalPrice ?? 0) - (j.discount ?? 0), 0);

  return (
    <>
      <p className="mb-3 text-[12.5px] text-muted-foreground">
        <span className="font-semibold text-foreground">{jobsInMonth.length}</span> job
        {jobsInMonth.length === 1 ? "" : "s"} ·{" "}
        <span className="tnum font-semibold text-foreground">{money(total)}</span> booked in{" "}
        {fmt(anchor, { month: "long" })}
      </p>
      <GlassCard className="p-2.5 sm:p-5">
        <div className="mb-1.5 grid grid-cols-7 gap-1 sm:gap-2">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <p
              key={d}
              className="py-1 text-center text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
            >
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </p>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {days.map((d, i) => {
            const day = contents.get(d);
            const jobs = day?.jobs ?? [];
            const others =
              (day?.timed ?? []).filter((t) => t.kind === "event").length +
              (day?.allDay ?? []).filter((a) => a.kind === "event").length;
            const dayOff = day?.allDay.find((a) => a.kind === "off");
            const isToday = d === today;
            const outside = !d.startsWith(month);
            const off = !schedules.get(d)?.open || day?.allDay.some((a) => a.kind === "off");
            return (
              <motion.button
                key={d}
                type="button"
                initial={{ opacity: 0, scale: 0.96 }}
                // Opacity lives here, not in a class: Motion's inline style
                // would override an `opacity-40` and un-dim other months' days.
                animate={{
                  opacity: outside ? 0.4 : 1,
                  scale: 1,
                  transition: { delay: Math.min(i * 0.006, 0.2) },
                }}
                whileTap={{ scale: 0.96 }}
                onClick={() => onDay(d)}
                className={`flex min-h-[58px] flex-col rounded-xl border p-1.5 text-left transition-colors sm:min-h-[112px] sm:rounded-2xl sm:p-2 ${
                  isToday
                    ? "border-primary/60 bg-primary/[0.06]"
                    : off
                      ? "cal-closed border-[var(--line-1)]"
                      : "border-[var(--line-1)] bg-[var(--fill-1)] hover:border-[var(--line-3)] hover:bg-[var(--fill-2)]"
                }`}
              >
                <span
                  className={`tnum inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-[12px] font-bold ${
                    isToday ? "text-primary-foreground" : "text-foreground"
                  }`}
                  style={isToday ? { backgroundImage: "var(--gradient-brand)" } : undefined}
                >
                  {Number(d.slice(8))}
                </span>

                {/* Phones: one coloured bar per job. */}
                <div className="mt-auto flex flex-wrap gap-0.5 sm:hidden">
                  {jobs.slice(0, 3).map((j) => (
                    <span
                      key={j.id}
                      className="cal-dot h-1.5 w-1.5 rounded-full"
                      style={{ "--c": jobColor(j) } as CSSProperties}
                    />
                  ))}
                  {others > 0 && <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />}
                </div>

                {/* Larger screens: who and when. */}
                <div className="mt-1.5 hidden min-w-0 space-y-1 sm:block">
                  {jobs.slice(0, 3).map((j) => (
                    <div
                      key={j.id}
                      className="cal-job truncate rounded-md px-1.5 py-[3px] text-[10.5px] font-semibold text-foreground"
                      style={{ "--c": jobColor(j) } as CSSProperties}
                      title={`${clock(toMinutes(j.startTime))} ${j.client?.name ?? ""} — ${j.serviceTitle}`}
                    >
                      <span className="tnum cal-ink">{clock(toMinutes(j.startTime), false)}</span>{" "}
                      {j.client?.name?.split(" ")[0] ?? ""}
                    </div>
                  ))}
                  {jobs.length > 3 && (
                    <p className="px-1 text-[10.5px] font-semibold text-primary">+{jobs.length - 3} more</p>
                  )}
                  {dayOff && dayOff.kind === "off" && (
                    <p className="cal-off cal-off-ink truncate rounded-md px-1.5 py-[3px] text-[10.5px] font-semibold">
                      {dayOff.off.reason || "Day off"}
                    </p>
                  )}
                  {jobs.length <= 2 && others > 0 && (
                    <p className="truncate px-1 text-[10.5px] text-muted-foreground">
                      {others} other event{others === 1 ? "" : "s"}
                    </p>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
      </GlassCard>
    </>
  );
}

function Legend({ googleConnected }: { googleConnected: boolean }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] text-muted-foreground">
      {PACKAGE_LEGEND.map((p) => (
        <span key={p.label} className="inline-flex items-center gap-1.5">
          <span className="cal-dot h-2.5 w-2.5 rounded-full" style={{ "--c": p.color } as CSSProperties} />
          {p.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="cal-event h-2.5 w-3.5 rounded" />
        {googleConnected ? "Google Calendar" : "Google not connected"}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="cal-off h-2.5 w-3.5 rounded" />
        Time off
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="cal-closed h-2.5 w-3.5 rounded border border-[var(--line-2)]" />
        Outside hours
      </span>
    </div>
  );
}

/** Everything you need on the driveway: who, what car, where, how to reach them. */
function JobPanel({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const start = job ? toMinutes(job.startTime) : 0;
  const phone = job?.client?.phone?.replace(/[^\d+]/g, "");
  const net = job ? (job.totalPrice ?? 0) - (job.discount ?? 0) : 0;
  const mapsUrl =
    job?.location === "mobile" && job.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`
      : null;

  return (
    <DetailPanel
      open={Boolean(job)}
      onClose={onClose}
      eyebrow={
        job ? `${fmt(job.date, { weekday: "long", month: "long", day: "numeric" })} · ${job.reference}` : ""
      }
      title={job?.client?.name ?? "Booking"}
      footer={
        <Link to="/admin/appointments" className="block">
          <Button variant="primary" className="w-full">Manage in Appointments</Button>
        </Link>
      }
    >
      {job && (
        <>
          <div
            className="cal-job mb-5 rounded-2xl px-4 py-3.5"
            style={{ "--c": jobColor(job) } as CSSProperties}
          >
            <p className="tnum cal-ink text-[12px] font-semibold">
              {range(start, start + job.durationMinutes)} · {duration(job.durationMinutes)}
            </p>
            <p className="mt-0.5 text-[17px] font-bold tracking-tight text-foreground">{job.serviceTitle}</p>
            {job.addOnTitles?.length ? (
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">+ {job.addOnTitles.join(", ")}</p>
            ) : null}
            <div className="mt-2.5 flex items-center justify-between">
              <StatusPill status={job.status} />
              <span className="tnum text-[16px] font-bold text-foreground">{money(net)}</span>
            </div>
          </div>

          {(phone || mapsUrl) && (
            <div className="mb-5 grid grid-cols-3 gap-2">
              {phone && (
                <a href={`tel:${phone}`} className="cal-quick">
                  <Phone className="h-4 w-4" /> Call
                </a>
              )}
              {phone && (
                <a href={`sms:${phone}`} className="cal-quick">
                  <MessageSquare className="h-4 w-4" /> Text
                </a>
              )}
              {mapsUrl && (
                <a href={mapsUrl} target="_blank" rel="noreferrer" className="cal-quick">
                  <MapPin className="h-4 w-4" /> Directions
                </a>
              )}
            </div>
          )}

          <DetailGroup title="Job">
            <DetailField label="Where" icon={job.location === "mobile" ? MapPin : Store}>
              {job.location === "mobile" ? job.address || "Mobile — no address" : "Drop-off at the shop"}
            </DetailField>
            {vehicleLine(job) && (
              <DetailField label="Vehicle" icon={Car}>
                {vehicleLine(job)}
              </DetailField>
            )}
            <DetailField label="Time" icon={Clock}>
              {range(start, start + job.durationMinutes)}
            </DetailField>
            <DetailField label="Payment">
              <span className="capitalize">{job.paymentStatus}</span>
              {job.amountPaid ? ` · ${money(job.amountPaid)} paid` : ""}
              {job.discount ? ` · ${money(job.discount)} discount` : ""}
            </DetailField>
            {job.notes && (
              <DetailField label="Notes">
                <span className="whitespace-pre-line">{job.notes}</span>
              </DetailField>
            )}
          </DetailGroup>

          <DetailGroup title="Client">
            {job.client?.phone && (
              <DetailField label="Phone" icon={Phone}>
                <a href={`tel:${phone}`} className="hover:text-primary">
                  {job.client.phone}
                </a>
              </DetailField>
            )}
            {job.client?.email && !job.client.email.endsWith("@phone.local") && (
              <DetailField label="Email" icon={Mail}>
                <a href={`mailto:${job.client.email}`} className="break-all hover:text-primary">
                  {job.client.email}
                </a>
              </DetailField>
            )}
          </DetailGroup>

          {job.googleEventId && (
            <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <ExternalLink className="h-3 w-3" /> Synced to Google Calendar
            </p>
          )}
        </>
      )}
    </DetailPanel>
  );
}
