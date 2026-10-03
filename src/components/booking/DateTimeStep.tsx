import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2 } from "lucide-react";

import { getAvailability, getBookableDays } from "@/lib/api/booking.functions";
import type { AddOnId, ServiceId } from "@/lib/services";
import type { Promo } from "@/lib/promo";

// The Lovable original generated fake availability client-side. This version
// keeps that UI — a grid where unbookable days are greyed out with a reason —
// but every value comes from the server, which reconciles business hours,
// Google Calendar busy blocks, and existing local bookings.

// Derived from the server function rather than hand-copied. The copy that
// used to live here silently went stale the moment a new reason was added,
// and the mismatch only surfaced as a type error in an unrelated file.
type DayAvailability = Awaited<ReturnType<typeof getBookableDays>>["days"][number];

type Slot = { startTime: string; startISO: string };

type Props = {
  serviceId: ServiceId;
  addOnIds: AddOnId[];
  /** Mobile can run different hours, so slots depend on it. */
  location: "mobile" | "shop" | null;
  date: string | null;
  time: string | null;
  onDate: (iso: string) => void;
  onTime: (t: string) => void;
  /** Next-season reservations, when running. */
  promo?: Promo | null;
  /** Showing next season's dates instead of the rolling window. */
  season?: boolean;
  onSeason?: (season: boolean) => void;
  /** The chosen service can only be booked in the promoted season. */
  lockSeason?: boolean;
};

const EASE = [0.22, 1, 0.36, 1] as const;
const PILL_SPRING = { type: "spring", stiffness: 420, damping: 36 } as const;

const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const numFmt = new Intl.DateTimeFormat("en-US", { day: "numeric" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short" });
const monthYearFmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

const reasonLabel: Record<NonNullable<DayAvailability["reason"]>, string> = {
  closed: "Closed this day",
  booked: "Fully booked",
  "lead-time": "Too soon to book",
  "time-off": "Unavailable this day",
};

/** Parse YYYY-MM-DD as a local date (avoids UTC shifting the day back one). */
function parseLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Every YYYY-MM from the month of `from` to the month of `to`, inclusive. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ty = Number(to.slice(0, 4));
  const tm = Number(to.slice(5, 7));
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** "14:30" -> "2:30 PM" */
export function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${period}`;
}

/**
 * Animates its own height to fit its content, so a panel grows and shrinks
 * smoothly when what's inside it changes. It only clips while the height is
 * moving — otherwise hover lifts and focus rings near the edge would be cut.
 */
function AutoHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={{ duration: 0.35, ease: EASE }}
      onAnimationStart={() => setMoving(true)}
      onAnimationComplete={() => setMoving(false)}
      className={moving ? "overflow-hidden" : ""}
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}

/** The sliding highlight behind whichever option is selected. */
function Pill({ id, className = "rounded-2xl" }: { id: string; className?: string }) {
  return (
    <motion.span
      layoutId={id}
      transition={PILL_SPRING}
      aria-hidden
      className={`absolute inset-0 -z-10 ${className}`}
      style={{ backgroundImage: "var(--gradient-brand)", boxShadow: "var(--shadow-glow)" }}
    />
  );
}

export function DateTimeStep({
  serviceId,
  addOnIds,
  location,
  date,
  time,
  onDate,
  onTime,
  promo,
  season = false,
  onSeason,
  lockSeason = false,
}: Props) {
  // The same wizard can be on the page twice (inline on /book and in the
  // overlay); scoping the shared-layout ids keeps their highlights apart.
  const groupId = useId();

  // Next season is browsed a month at a time, starting where it opens.
  const seasonMonths = useMemo(
    () => (promo?.enabled ? monthsBetween(promo.seasonStart, promo.seasonEnd) : []),
    [promo?.enabled, promo?.seasonStart, promo?.seasonEnd],
  );
  const [month, setMonth] = useState<string | null>(null);
  const activeMonth = season ? (month ?? seasonMonths[0] ?? null) : null;
  const monthIndex = activeMonth ? seasonMonths.indexOf(activeMonth) : -1;
  /** Which way the calendar slides: forward in time is 1, back is -1. */
  const [slide, setSlide] = useState(1);

  // What the calendar is showing. The previous grid stays up (dimmed) while
  // the next one loads, then they cross over — no flash of a spinner.
  const view = season ? (activeMonth ?? "season") : "now";
  const [shownDays, setShownDays] = useState<{ view: string; days: DayAvailability[] } | null>(
    null,
  );
  const [loadingDays, setLoadingDays] = useState(false);
  const [daysError, setDaysError] = useState<string | null>(null);

  // Same idea for times: keep the last day's times up until the new ones land.
  const [shownSlots, setShownSlots] = useState<{ date: string; slots: Slot[] } | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  // Add-ons lengthen the job, which can remove late-day slots — so the day
  // grid depends on the add-on selection, not just the package.
  const addOnKey = useMemo(() => [...addOnIds].sort().join(","), [addOnIds]);

  useEffect(() => {
    let cancelled = false;
    setLoadingDays(true);
    setDaysError(null);

    getBookableDays({
      data: {
        serviceId,
        addOnIds,
        location: location ?? undefined,
        month: activeMonth ?? undefined,
      },
    })
      .then((res) => {
        if (!cancelled) setShownDays({ view, days: res.days });
      })
      .catch(() => {
        if (!cancelled) setDaysError("Couldn't load the calendar. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoadingDays(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, addOnKey, location, activeMonth, view]);

  useEffect(() => {
    if (!date) {
      setShownSlots(null);
      setLoadingSlots(false);
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    setSlotsError(null);

    getAvailability({ data: { date, serviceId, addOnIds, location: location ?? undefined } })
      .then((res) => {
        if (!cancelled) setShownSlots({ date, slots: res.slots });
      })
      .catch(() => {
        if (!cancelled) setSlotsError("Couldn't load times for that day.");
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, serviceId, addOnKey, location]);

  const days = shownDays?.days ?? null;
  const selectedDay = days?.find((d) => d.date === date && d.available) ?? null;

  const goMonth = (dir: 1 | -1) => {
    const next = seasonMonths[monthIndex + dir];
    if (!next) return;
    setSlide(dir);
    setMonth(next);
  };

  const switchSeason = (next: boolean) => {
    if (!onSeason || next === season) return;
    setSlide(next ? 1 : -1);
    onSeason(next);
  };

  // What the times panel shows, as one keyed state so changes cross-fade.
  const slotView: { key: string; node: ReactNode } = !selectedDay
    ? {
        key: "pick",
        node: <p className="text-sm text-muted-foreground">Pick an open date to see times.</p>,
      }
    : slotsError
      ? {
          key: "error",
          node: <p className="text-sm font-medium text-destructive">{slotsError}</p>,
        }
      : !shownSlots
        ? {
            key: "skeleton",
            node: (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" aria-busy="true">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-[46px] animate-pulse rounded-2xl bg-secondary/50" />
                ))}
              </div>
            ),
          }
        : !shownSlots.slots.length
          ? {
              key: `empty-${shownSlots.date}`,
              node: (
                <p className="text-sm text-muted-foreground">
                  No times left on that day — try another date.
                </p>
              ),
            }
          : {
              key: `slots-${shownSlots.date}`,
              node: (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {shownSlots.slots.map((s, i) => {
                    const active = s.startTime === time;
                    return (
                      <motion.button
                        key={s.startTime}
                        type="button"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: Math.min(i * 0.015, 0.3), ease: EASE }}
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => onTime(s.startTime)}
                        className={`relative isolate rounded-2xl border px-3 py-3 text-sm font-semibold transition-colors duration-200 ${
                          active
                            ? "border-transparent text-white"
                            : "border-border bg-card text-foreground hover:border-primary/50"
                        }`}
                      >
                        {active && <Pill id="slot" />}
                        {formatTime12h(s.startTime)}
                      </motion.button>
                    );
                  })}
                </div>
              ),
            };

  return (
    <LayoutGroup id={groupId}>
      <div className="grid gap-5">
        {promo?.enabled && lockSeason && (
          <div className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm">
            <span className="font-semibold text-foreground">
              Booked for the {promo.seasonLabel}
            </span>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">
              {promo.percent}% off
            </span>
          </div>
        )}

        {promo?.enabled && onSeason && !lockSeason && (
          <div
            className="glass grid grid-cols-2 gap-1 rounded-2xl p-1"
            role="tablist"
            aria-label="Season"
          >
            {[
              { value: false, label: "This season", badge: null as string | null },
              { value: true, label: promo.seasonLabel, badge: `${promo.percent}% off` },
            ].map((opt) => {
              const active = season === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => switchSeason(opt.value)}
                  className={`relative isolate flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-300 ${
                    active ? "text-white" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {active && <Pill id="season" className="rounded-xl" />}
                  {opt.label}
                  {opt.badge && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold transition-colors duration-300 ${
                        active ? "bg-white/20 text-white" : "bg-primary/15 text-primary"
                      }`}
                    >
                      {opt.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="glass rounded-3xl p-5">
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <CalendarDays className="h-3.5 w-3.5" /> Available dates
            </p>
            {season && activeMonth ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Previous month"
                  disabled={monthIndex <= 0}
                  onClick={() => goMonth(-1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground transition hover:border-primary/50 disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="relative min-w-[8.5rem] overflow-hidden text-center text-sm font-semibold text-foreground">
                  <AnimatePresence mode="popLayout" initial={false} custom={slide}>
                    <motion.span
                      key={activeMonth}
                      custom={slide}
                      initial={{ opacity: 0, y: slide * 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: slide * -10 }}
                      transition={{ duration: 0.25, ease: EASE }}
                      className="block"
                    >
                      {monthYearFmt.format(parseLocal(`${activeMonth}-01`))}
                    </motion.span>
                  </AnimatePresence>
                </span>
                <button
                  type="button"
                  aria-label="Next month"
                  disabled={monthIndex < 0 || monthIndex >= seasonMonths.length - 1}
                  onClick={() => goMonth(1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground transition hover:border-primary/50 disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Greyed-out days are closed or fully booked
              </p>
            )}
          </div>

          <AutoHeight>
            {season && promo?.enabled && (
              <p className="mt-3 text-[13px] text-muted-foreground">
                Reserve any open day in the {promo.seasonLabel}. {promo.percent}% off is applied
                automatically.
              </p>
            )}

            {daysError ? (
              <p className="mt-4 text-sm font-medium text-destructive">{daysError}</p>
            ) : !shownDays ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking the calendar…
              </div>
            ) : (
              <div
                className={`mt-4 transition-opacity duration-200 ${
                  loadingDays ? "pointer-events-none opacity-50" : "opacity-100"
                }`}
              >
                <AnimatePresence mode="wait" initial={false} custom={slide}>
                  <motion.div
                    key={shownDays.view}
                    custom={slide}
                    initial={{ opacity: 0, x: slide * 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: slide * -24 }}
                    transition={{ duration: 0.28, ease: EASE }}
                  >
                    {shownDays.days.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No open dates this month.</p>
                    ) : (
                      <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-7">
                        {shownDays.days.map((d, i) => {
                          const dt = parseLocal(d.date);
                          const active = d.date === date && d.available;
                          const disabled = !d.available;
                          return (
                            <motion.button
                              key={d.date}
                              type="button"
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{
                                duration: 0.3,
                                delay: Math.min(i * 0.01, 0.3),
                                ease: EASE,
                              }}
                              {...(disabled
                                ? {}
                                : { whileHover: { y: -3 }, whileTap: { scale: 0.96 } })}
                              disabled={disabled}
                              aria-disabled={disabled}
                              aria-pressed={active}
                              aria-label={`${dayFmt.format(dt)} ${monthFmt.format(dt)} ${numFmt.format(dt)}${
                                disabled && d.reason ? ` — ${reasonLabel[d.reason]}` : ""
                              }`}
                              title={disabled && d.reason ? reasonLabel[d.reason] : undefined}
                              onClick={() => !disabled && onDate(d.date)}
                              className={`relative isolate rounded-2xl border px-2 py-3 text-center transition-colors duration-200 ${
                                active
                                  ? "border-transparent text-white"
                                  : disabled
                                    ? "cursor-not-allowed border-border/60 bg-muted/40 text-muted-foreground/50 line-through decoration-muted-foreground/40"
                                    : "border-border bg-card text-foreground hover:border-primary/50"
                              }`}
                            >
                              {active && <Pill id="day" />}
                              <span className="block text-[10px] font-semibold uppercase tracking-wider opacity-80">
                                {dayFmt.format(dt)}
                              </span>
                              <span className="block text-lg font-bold leading-tight">
                                {numFmt.format(dt)}
                              </span>
                              <span className="block text-[10px] opacity-70">
                                {monthFmt.format(dt)}
                              </span>
                            </motion.button>
                          );
                        })}
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            )}
          </AutoHeight>
        </div>

        <div className="glass rounded-3xl p-5">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <Clock className="h-3.5 w-3.5" /> Time slots
          </p>

          <AutoHeight>
            <div
              className={`mt-4 transition-opacity duration-200 ${
                loadingSlots && shownSlots ? "opacity-50" : "opacity-100"
              }`}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={slotView.key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: EASE }}
                >
                  {slotView.node}
                </motion.div>
              </AnimatePresence>
            </div>
          </AutoHeight>
        </div>
      </div>
    </LayoutGroup>
  );
}
