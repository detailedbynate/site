import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  Ban,
  Car,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
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
  Spinner,
  StatusPill,
  money,
} from "@/components/admin/ui";
import { NewAppointmentDialog } from "@/components/admin/NewAppointmentDialog";
import { Timeline } from "@/components/admin/calendar/Timeline";
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
  type AllDayItem,
  type DayContents,
  type GEvent,
  type Hours,
  type Job,
  type TimedItem,
  type TimeOffEntry,
} from "@/components/admin/calendar/model";

export const Route = createFileRoute("/admin/calendar")({
  component: CalendarPage,
});

type View = "day" | "week" | "month";
type Filter = "all" | "jobs" | "google" | "off";
type Settings = Awaited<ReturnType<typeof getAdminSettings>>["settings"];

const PREFS_KEY = "dbn.admin.calendar.prefs";

function readPrefs(): { view: View; fit: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return {
      view: p.view === "week" || p.view === "month" ? p.view : "day",
      fit: p.fit !== false,
    };
  } catch {
    return { view: "day", fit: true };
  }
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
  return (hit?.schedule ?? s.weeklySchedule)?.[weekday];
}

/** Drop what the "All events" filter hides. */
function filterDay(day: DayContents | undefined, f: Filter): DayContents {
  const d = day ?? { timed: [], allDay: [], jobs: [] };
  if (f === "all") return d;
  const keep = (k: string) => (f === "jobs" ? k === "job" : f === "google" ? k === "event" : k === "off");
  return {
    timed: d.timed.filter((t) => keep(t.kind)),
    allDay: d.allDay.filter((a) => keep(a.kind)),
    jobs: f === "jobs" ? d.jobs : [],
  };
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
  const [fit, setFitState] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  // Restored after mount: localStorage doesn't exist during SSR.
  useEffect(() => {
    const p = readPrefs();
    setViewState(p.view);
    setFitState(p.fit);
  }, []);
  const save = (patch: Partial<{ view: View; fit: boolean }>) => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
    } catch {
      // Not worth surfacing.
    }
  };
  const setView = (v: View) => {
    setViewState(v);
    save({ view: v });
  };
  const setFit = (v: boolean) => {
    setFitState(v);
    save({ fit: v });
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
  const loadJobs = useCallback(() => {
    listAppointments()
      .then((r) => setJobs(r.bookings))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
  }, []);

  useEffect(() => {
    loadTimeOff();
    loadJobs();
    getAdminSettings()
      .then((r) => setSettings(r.settings))
      .catch(() => setSettings(null));
  }, [loadTimeOff, loadJobs]);

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

  const isTodayView = view === "day" && anchor === now.date;
  const eyebrow =
    view === "day"
      ? anchor === now.date
        ? "Today"
        : anchor === addDays(now.date, 1)
          ? "Tomorrow"
          : anchor === addDays(now.date, -1)
            ? "Yesterday"
            : fmt(anchor, { weekday: "long" })
      : view === "week"
        ? week.includes(now.date)
          ? "This week"
          : `Week of ${fmt(week[0], { month: "short", day: "numeric" })}`
        : fmt(anchor, { year: "numeric" });
  const title =
    view === "day"
      ? fmt(
          anchor,
          anchor === now.date
            ? { weekday: "long", month: "short", day: "numeric" }
            : { month: "long", day: "numeric" },
        )
      : view === "week"
        ? `${fmt(week[0], { month: "short", day: "numeric" })} – ${fmt(week[6], {
            month: week[0].slice(5, 7) === week[6].slice(5, 7) ? undefined : "short",
            day: "numeric",
          })}`
        : fmt(anchor, { month: "long" });

  const day = filterDay(contents.get(anchor), filter);
  const sched = schedules.get(anchor);
  const workHours = sched?.open
    ? `${clock(sched.openHour * 60)} – ${clock(sched.closeHour * 60)}`
    : "Closed";

  /** Hours on the axis: your working day when "fit" is on, otherwise 6 AM – 10 PM. */
  const axis = (scheds: (Hours | undefined)[], items: TimedItem[]): [number, number] => {
    const fitted = visibleHours(scheds, items);
    return fit ? fitted : [Math.min(6, fitted[0]), Math.max(22, fitted[1])];
  };

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="cal-stage -mx-2 sm:mx-0"
      >
        {/* ------------------------------- head ------------------------------- */}
        <div className="cal-stage-head relative px-4 pb-6 pt-5 sm:px-7 sm:pt-7">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[var(--st-ink-soft)]">{eyebrow}</p>
              <h1 className="mt-0.5 truncate text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--st-ink)] sm:text-[36px]">
                {title}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <RoundButton label="Previous" onClick={() => step(-1)}>
                <ChevronLeft className="h-[18px] w-[18px]" />
              </RoundButton>
              <RoundButton label="Next" onClick={() => step(1)}>
                <ChevronRight className="h-[18px] w-[18px]" />
              </RoundButton>
            </div>
          </div>

          {/* Today / Day / Week / Month */}
          <div className="cal-frost mt-5 grid grid-cols-4 rounded-full p-1">
            {(
              [
                { key: "today", label: "Today", active: isTodayView },
                { key: "day", label: "Day", active: view === "day" && !isTodayView },
                { key: "week", label: "Week", active: view === "week" },
                { key: "month", label: "Month", active: view === "month" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.active}
                onClick={() => {
                  if (t.key === "today") {
                    setAnchor(now.date);
                    setView("day");
                  } else setView(t.key);
                }}
                className="relative rounded-full py-2.5 text-[13.5px] font-medium transition-colors"
              >
                {t.active && (
                  <motion.span
                    layoutId="cal-seg"
                    className="cal-frost-active absolute inset-0 rounded-full"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <span className={`relative ${t.active ? "text-[var(--background)]" : "opacity-75"}`}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>

          {view !== "month" && (
            <Capsules
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

          {/* Working hours + filter */}
          <div className="mt-4 grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2.5">
            <div className="cal-frost flex items-center gap-2.5 rounded-full py-1.5 pl-3 pr-1.5">
              <Clock className="h-4 w-4 shrink-0 opacity-80" />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-[10.5px] opacity-70">Working hours</p>
                <p className="tnum truncate text-[12px] font-medium">
                  {view === "day" ? workHours : "Fit to hours"}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={fit}
                aria-label="Fit timeline to working hours"
                onClick={() => setFit(!fit)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  fit ? "bg-primary" : "bg-[var(--fill-3)]"
                }`}
              >
                <motion.span
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow ${fit ? "right-1" : "left-1"}`}
                />
              </button>
            </div>
            <label className="cal-frost relative flex items-center gap-2 rounded-full px-3.5">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as Filter)}
                className="h-full w-full cursor-pointer appearance-none bg-transparent py-3 pr-5 text-[12.5px] font-medium text-inherit outline-none"
                aria-label="Show"
              >
                <option value="all">All events</option>
                <option value="jobs">Jobs only</option>
                <option value="google">Google events</option>
                <option value="off">Time off</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 opacity-70" />
            </label>
          </div>
        </div>

        {/* ------------------------------- body ------------------------------- */}
        <motion.div
          key={`${view}-${view === "month" ? anchor.slice(0, 7) : view === "week" ? week[0] : anchor}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="cal-stage-body relative px-4 pb-5 pt-5 sm:px-7 sm:pb-7"
        >
          {view === "day" && (
            <DayBody
              date={anchor}
              day={day}
              schedule={sched}
              hours={axis([sched], day.timed)}
              now={now}
              busy={busy}
              googleConnected={gcal.connected}
              onJob={setOpenJob}
              onBlock={blockDay}
              onUnblock={unblock}
            />
          )}

          {view === "week" && (
            <WeekBody
              days={week}
              contents={contents}
              filter={filter}
              schedules={schedules}
              axis={axis}
              now={now}
              onJob={setOpenJob}
              onDay={(d) => {
                setAnchor(d);
                setView("day");
              }}
            />
          )}

          {view === "month" && (
            <MonthBody
              anchor={anchor}
              days={grid}
              contents={contents}
              filter={filter}
              schedules={schedules}
              today={now.date}
              onDay={(d) => {
                setAnchor(d);
                setView("day");
              }}
            />
          )}

          <motion.button
            type="button"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setCreating(true)}
            style={{ backgroundImage: "var(--gradient-brand)" }}
            className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-full py-4 text-[15px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)]"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] border-current">
              <Plus className="h-3.5 w-3.5" />
            </span>
            New appointment
          </motion.button>

          <Legend googleConnected={gcal.connected} />
        </motion.div>
      </motion.section>

      <JobPanel job={openJob} onClose={() => setOpenJob(null)} />
      <NewAppointmentDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          loadJobs();
        }}
      />
    </>
  );
}

// ------------------------------- pieces -----------------------------------

function RoundButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      aria-label={label}
      className="cal-frost flex h-11 w-11 items-center justify-center rounded-full transition-opacity hover:opacity-85"
    >
      {children}
    </motion.button>
  );
}

/** Tall frosted day capsules, Monday first; the chosen day turns solid white. */
function Capsules({
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
    <div className="mt-4 grid grid-cols-7 gap-1.5 sm:gap-3">
      {days.map((d) => {
        const isSel = d === selected;
        const day = contents.get(d);
        const closed = !schedules.get(d)?.open || day?.allDay.some((a) => a.kind === "off");
        const count = day?.jobs.length ?? 0;
        return (
          <motion.button
            key={d}
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={() => onPick(d)}
            className={`cal-frost relative flex flex-col items-center rounded-full pb-3 pt-3 sm:pb-3.5 sm:pt-3.5 ${
              closed && !isSel ? "opacity-55" : ""
            }`}
          >
            {isSel && (
              <motion.span
                layoutId="cal-capsule"
                className="cal-frost-active absolute inset-0 rounded-full"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span
              className={`relative text-[11px] font-medium ${isSel ? "text-[var(--background)]" : "opacity-70"}`}
            >
              {fmt(d, { weekday: "narrow" })}
              <span className="hidden sm:inline">{fmt(d, { weekday: "short" }).slice(1)}</span>
            </span>
            <span
              className={`tnum relative mt-1 text-[17px] font-semibold leading-none sm:text-[19px] ${
                isSel ? "text-[var(--background)]" : ""
              } ${d === today && !isSel ? "underline decoration-[var(--st-accent)] decoration-2 underline-offset-4" : ""}`}
            >
              {Number(d.slice(8))}
            </span>
            <span className="relative mt-2 flex h-1.5 items-center gap-[3px]">
              {count > 0 &&
                (isSel ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--st-accent)]" />
                ) : (
                  day!.jobs.slice(0, 3).map((j) => (
                    <span
                      key={j.id}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: jobColor(j) }}
                    />
                  ))
                ))}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

function AllDayRow({ items }: { items: AllDayItem[] }) {
  if (!items.length) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {items.map((it) =>
        it.kind === "off" ? (
          <span
            key={it.id}
            className="cal-off-band flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold cal-off-ink"
          >
            <Ban className="h-3.5 w-3.5" /> {it.off.reason || "Day off"}
          </span>
        ) : (
          <a
            key={it.id}
            href={it.event.htmlLink}
            target="_blank"
            rel="noreferrer"
            className="cal-glass-ghost rounded-full px-3 py-1.5 text-[12px] font-medium text-foreground/90"
          >
            {it.event.summary} · all day
          </a>
        ),
      )}
    </div>
  );
}

function DayBody({
  date,
  day,
  schedule,
  hours,
  now,
  busy,
  googleConnected,
  onJob,
  onBlock,
  onUnblock,
}: {
  date: string;
  day: DayContents;
  schedule: Hours | undefined;
  hours: [number, number];
  now: { date: string; minute: number };
  busy: boolean;
  googleConnected: boolean;
  onJob: (j: Job) => void;
  onBlock: (d: string) => void;
  onUnblock: (id: string) => void;
}) {
  const jobs = day.jobs;
  const value = jobs.reduce((s, j) => s + (j.totalPrice ?? 0) - (j.discount ?? 0), 0);
  const bookedMin = jobs.reduce((s, j) => s + j.durationMinutes, 0);
  const openMin = schedule?.open ? (schedule.closeHour - schedule.openHour) * 60 : 0;
  const gaps = freeGaps(day, schedule);
  const offs = [
    ...day.allDay.flatMap((a) => (a.kind === "off" ? [a.off] : [])),
    ...day.timed.flatMap((t) => (t.kind === "off" ? [t.off] : [])),
  ];

  return (
    <>
      <AllDayRow items={day.allDay} />
      <Timeline
        rows={[
          {
            key: date,
            items: day.timed,
            schedule,
            isToday: date === now.date,
            empty: schedule?.open ? "Nothing booked — the whole day is open" : "Closed",
          },
        ]}
        hours={hours}
        minHourPx={124}
        laneHeight={132}
        nowMinute={now.minute}
        onJob={onJob}
      />

      {/* Day summary, on the glass. */}
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="cal-glass rounded-3xl p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Day</p>
          <div className="mt-2 flex items-end gap-5">
            <div>
              <p className="tnum text-[26px] font-light leading-none text-foreground">{jobs.length}</p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">job{jobs.length === 1 ? "" : "s"}</p>
            </div>
            <div>
              <p className="tnum text-[26px] font-light leading-none text-foreground">{money(value)}</p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">booked</p>
            </div>
          </div>
          {openMin > 0 && (
            <>
              <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-[var(--fill-3)]">
                <motion.div
                  className="h-full rounded-full bg-[var(--st-accent)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (bookedMin / openMin) * 100)}%` }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                />
              </div>
              <p className="tnum mt-1.5 text-[11.5px] text-muted-foreground">
                {duration(bookedMin)} of {duration(openMin)} booked
              </p>
            </>
          )}
        </div>

        <div className="cal-glass rounded-3xl p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Free time</p>
          {gaps.length ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {gaps.map(([a, b]) => (
                <span
                  key={a}
                  className="tnum rounded-full border border-dashed border-[var(--line-3)] px-3 py-1.5 text-[12px] font-medium text-foreground/90"
                >
                  {range(a, b)} <span className="text-muted-foreground">· {duration(b - a)}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              {schedule?.open ? "No gaps of an hour or more." : "Closed this day."}
            </p>
          )}
        </div>

        {/*
          Blocking time lives on the day itself, because this is where you
          are when you realise you need it — and it works without Google.
        */}
        <div className="cal-glass rounded-3xl p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Availability
          </p>
          {offs.length ? (
            <ul className="mt-2.5 space-y-2">
              {offs.map((t) => (
                <li key={t.id} className="cal-off-band flex items-center gap-2 rounded-2xl px-3 py-2">
                  <Ban className="h-3.5 w-3.5 shrink-0 cal-off-ink" />
                  <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold cal-off-ink">
                    {t.allDay
                      ? "Off all day"
                      : `Off ${clock(toMinutes(t.startTime))} – ${clock(toMinutes(t.endTime))}`}
                    {t.reason ? <span className="font-normal opacity-70"> · {t.reason}</span> : null}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onUnblock(t.id)}
                    className="rounded-full p-1 text-muted-foreground hover:bg-[var(--fill-3)] hover:text-foreground disabled:opacity-50"
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
                  ? `Open for online booking ${clock(schedule.openHour * 60)} – ${clock(schedule.closeHour * 60)}.`
                  : "Closed under your weekly hours."}
              </p>
              {schedule?.open && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onBlock(date)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--line-3)] px-3.5 py-1.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-[var(--fill-3)] disabled:opacity-50"
                >
                  <Ban className="h-3.5 w-3.5" /> Block this day off
                </button>
              )}
            </>
          )}
          {jobs.length > 0 && offs.length > 0 && (
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
              Blocking stops new bookings; jobs already booked stay put.
            </p>
          )}
          {!googleConnected && (
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
              Connect Google Calendar under Integrations to see other commitments here.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/** One row per day, hours across — a dispatch board for the week. */
function WeekBody({
  days,
  contents,
  filter,
  schedules,
  axis,
  now,
  onJob,
  onDay,
}: {
  days: string[];
  contents: Map<string, DayContents>;
  filter: Filter;
  schedules: Map<string, Hours | undefined>;
  axis: (s: (Hours | undefined)[], items: TimedItem[]) => [number, number];
  now: { date: string; minute: number };
  onJob: (j: Job) => void;
  onDay: (d: string) => void;
}) {
  const filtered = days.map((d) => ({ d, day: filterDay(contents.get(d), filter) }));
  const hours = axis(
    days.map((d) => schedules.get(d)),
    filtered.flatMap((f) => f.day.timed),
  );
  const all = filtered.flatMap((f) => f.day.jobs);
  const total = all.reduce((s, j) => s + (j.totalPrice ?? 0) - (j.discount ?? 0), 0);

  return (
    <>
      <p className="mb-4 text-[13px] text-muted-foreground">
        <span className="font-semibold text-foreground">{all.length}</span> job{all.length === 1 ? "" : "s"} ·{" "}
        <span className="tnum font-semibold text-foreground">{money(total)}</span> booked this week
      </p>
      <Timeline
        rows={filtered.map(({ d, day }) => {
          const off = day.allDay.find((a) => a.kind === "off");
          const allDayEvents = day.allDay.filter((a) => a.kind === "event").length;
          return {
            key: d,
            isToday: d === now.date,
            schedule: off ? { open: false, openHour: 0, closeHour: 0 } : schedules.get(d),
            items: day.timed,
            empty: off && off.kind === "off" ? off.off.reason || "Day off" : undefined,
            label: (
              <button type="button" onClick={() => onDay(d)} className="text-left">
                <p
                  className={`text-[11px] font-medium ${d === now.date ? "text-[var(--st-accent)]" : "text-muted-foreground"}`}
                >
                  {fmt(d, { weekday: "short" })}
                </p>
                <p className="tnum text-[20px] font-light leading-tight text-foreground">{Number(d.slice(8))}</p>
                {allDayEvents > 0 && <p className="text-[10px] text-muted-foreground">+{allDayEvents} all-day</p>}
              </button>
            ),
          };
        })}
        hours={hours}
        minHourPx={96}
        laneHeight={64}
        labelWidth={60}
        nowMinute={now.minute}
        compact
        onJob={onJob}
      />
    </>
  );
}

function MonthBody({
  anchor,
  days,
  contents,
  filter,
  schedules,
  today,
  onDay,
}: {
  anchor: string;
  days: string[];
  contents: Map<string, DayContents>;
  filter: Filter;
  schedules: Map<string, Hours | undefined>;
  today: string;
  onDay: (d: string) => void;
}) {
  const month = anchor.slice(0, 7);
  const jobsInMonth = days
    .filter((d) => d.startsWith(month))
    .flatMap((d) => filterDay(contents.get(d), filter).jobs);
  const total = jobsInMonth.reduce((s, j) => s + (j.totalPrice ?? 0) - (j.discount ?? 0), 0);

  return (
    <>
      <p className="mb-4 text-[13px] text-muted-foreground">
        <span className="font-semibold text-foreground">{jobsInMonth.length}</span> job
        {jobsInMonth.length === 1 ? "" : "s"} ·{" "}
        <span className="tnum font-semibold text-foreground">{money(total)}</span> booked in{" "}
        {fmt(anchor, { month: "long" })}
      </p>
      <div className="mb-2 grid grid-cols-7 gap-1.5 sm:gap-2.5">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <p key={i} className="text-center text-[11px] font-medium text-muted-foreground">
            {d}
          </p>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5">
        {days.map((d, i) => {
          const day = filterDay(contents.get(d), filter);
          const outside = !d.startsWith(month);
          const off = day.allDay.find((a) => a.kind === "off");
          const closed = !schedules.get(d)?.open || Boolean(off);
          const others =
            day.timed.filter((t) => t.kind === "event").length +
            day.allDay.filter((a) => a.kind === "event").length;
          const isToday = d === today;
          return (
            <motion.button
              key={d}
              type="button"
              initial={{ opacity: 0, scale: 0.95 }}
              // Opacity lives here, not in a class: Motion's inline style
              // would override an `opacity-*` and un-dim other months' days.
              animate={{
                opacity: outside ? 0.35 : 1,
                scale: 1,
                transition: { delay: Math.min(i * 0.006, 0.2) },
              }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onDay(d)}
              className={`flex min-h-[64px] flex-col rounded-2xl p-1.5 text-left sm:min-h-[118px] sm:rounded-3xl sm:p-2.5 ${
                closed ? "cal-glass-ghost" : "cal-glass"
              } ${isToday ? "ring-2 ring-[var(--st-accent)]" : ""}`}
            >
              <span
                className={`tnum text-[13px] font-semibold sm:text-[15px] ${isToday ? "text-[var(--st-accent)]" : "text-foreground"}`}
              >
                {Number(d.slice(8))}
              </span>

              {/* Phones: a dot per job. */}
              <span className="mt-auto flex flex-wrap gap-[3px] sm:hidden">
                {day.jobs.slice(0, 3).map((j) => (
                  <span key={j.id} className="h-1.5 w-1.5 rounded-full" style={{ background: jobColor(j) }} />
                ))}
                {off && <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />}
              </span>

              {/* Larger screens: who and when. */}
              <div className="mt-1.5 hidden min-w-0 space-y-1 sm:block">
                {day.jobs.slice(0, 3).map((j) => (
                  <p
                    key={j.id}
                    className="flex min-w-0 items-center gap-1.5 truncate rounded-full bg-[var(--fill-2)] px-2 py-[3px] text-[11px] text-foreground/90"
                    title={`${clock(toMinutes(j.startTime))} ${j.client?.name ?? ""} — ${j.serviceTitle}`}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: jobColor(j) }} />
                    <span className="tnum text-muted-foreground">{clock(toMinutes(j.startTime), false)}</span>
                    <span className="truncate">{j.client?.name?.split(" ")[0] ?? ""}</span>
                  </p>
                ))}
                {day.jobs.length > 3 && (
                  <p className="px-2 text-[10.5px] font-semibold text-muted-foreground">+{day.jobs.length - 3} more</p>
                )}
                {off && off.kind === "off" && (
                  <p className="truncate px-1 text-[10.5px] font-semibold cal-off-ink">
                    {off.off.reason || "Day off"}
                  </p>
                )}
                {day.jobs.length <= 2 && others > 0 && (
                  <p className="truncate px-1 text-[10.5px] text-muted-foreground">
                    {others} other event{others === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>
    </>
  );
}

function Legend({ googleConnected }: { googleConnected: boolean }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      {PACKAGE_LEGEND.map((p) => (
        <span key={p.label} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="cal-glass-ghost h-2 w-3 rounded" />
        {googleConnected ? "Google" : "Google not connected"}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="cal-off-band h-2 w-3 rounded" />
        Time off
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
          <Button variant="primary" className="w-full">
            Manage in Appointments
          </Button>
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
