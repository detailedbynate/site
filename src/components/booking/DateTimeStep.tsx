import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { CalendarDays, Clock, Loader2 } from "lucide-react";

import { getAvailability, getBookableDays } from "@/lib/api/booking.functions";
import type { AddOnId, ServiceId } from "@/lib/services";

// The Lovable original generated fake availability client-side. This version
// keeps that UI exactly — a 3-week grid where unbookable days are greyed out
// with a reason — but every value now comes from the server, which reconciles
// business hours, Google Calendar busy blocks, and existing local bookings.

type DayAvailability = {
  date: string;
  available: boolean;
  slotCount: number;
  reason?: "closed" | "booked" | "lead-time";
};

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
};

const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const numFmt = new Intl.DateTimeFormat("en-US", { day: "numeric" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short" });

const reasonLabel: Record<NonNullable<DayAvailability["reason"]>, string> = {
  closed: "Closed this day",
  booked: "Fully booked",
  "lead-time": "Too soon to book",
};

/** Parse YYYY-MM-DD as a local date (avoids UTC shifting the day back one). */
function parseLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "14:30" -> "2:30 PM" */
export function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${period}`;
}

export function DateTimeStep({ serviceId, addOnIds, location, date, time, onDate, onTime }: Props) {
  const [days, setDays] = useState<DayAvailability[] | null>(null);
  const [daysError, setDaysError] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Add-ons lengthen the job, which can remove late-day slots — so the day
  // grid depends on the add-on selection, not just the package.
  const addOnKey = useMemo(() => [...addOnIds].sort().join(","), [addOnIds]);

  useEffect(() => {
    let cancelled = false;
    setDays(null);
    setDaysError(null);

    getBookableDays({ data: { serviceId, addOnIds, location: location ?? undefined } })
      .then((res) => {
        if (!cancelled) setDays(res.days);
      })
      .catch(() => {
        if (!cancelled) setDaysError("Couldn't load the calendar. Please try again.");
      });

    return () => {
      cancelled = true;
    };
  }, [serviceId, addOnKey, location]);

  useEffect(() => {
    if (!date) {
      setSlots(null);
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    setSlotsError(null);
    // Deliberately NOT clearing `slots` here — blanking it collapses the
    // panel for one frame and it visibly snaps back when data arrives.

    getAvailability({ data: { date, serviceId, addOnIds, location: location ?? undefined } })
      .then((res) => {
        if (!cancelled) setSlots(res.slots);
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
  }, [date, serviceId, addOnKey, location]);

  const selectedDay = days?.find((d) => d.date === date && d.available) ?? null;

  return (
    <div className="grid gap-5">
      <div className="glass rounded-3xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <CalendarDays className="h-3.5 w-3.5" /> Available dates
          </p>
          <p className="text-[11px] text-muted-foreground">
            Greyed-out days are closed or fully booked
          </p>
        </div>

        {daysError ? (
          <p className="mt-4 text-sm font-medium text-destructive">{daysError}</p>
        ) : !days ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking the calendar…
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-4 gap-2.5 sm:grid-cols-7">
            {days.map((d, i) => {
              const dt = parseLocal(d.date);
              const active = d.date === date && d.available;
              const disabled = !d.available;
              return (
                <motion.button
                  key={d.date}
                  type="button"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: i * 0.015 } }}
                  {...(disabled ? {} : { whileHover: { y: -4 }, whileTap: { scale: 0.96 } })}
                  disabled={disabled}
                  aria-disabled={disabled}
                  aria-label={`${dayFmt.format(dt)} ${monthFmt.format(dt)} ${numFmt.format(dt)}${
                    disabled && d.reason ? ` — ${reasonLabel[d.reason]}` : ""
                  }`}
                  title={disabled && d.reason ? reasonLabel[d.reason] : undefined}
                  onClick={() => !disabled && onDate(d.date)}
                  className={`rounded-2xl border px-2 py-3 text-center transition-colors ${
                    active
                      ? "border-transparent text-primary-foreground"
                      : disabled
                        ? "cursor-not-allowed border-border/60 bg-muted/40 text-muted-foreground/50 line-through decoration-muted-foreground/40"
                        : "border-border bg-card text-foreground hover:border-primary/50"
                  }`}
                  style={
                    active
                      ? { backgroundImage: "var(--gradient-brand)", boxShadow: "var(--shadow-glow)" }
                      : {}
                  }
                >
                  <span className="block text-[10px] font-semibold uppercase tracking-wider opacity-80">
                    {dayFmt.format(dt)}
                  </span>
                  <span className="block text-lg font-bold leading-tight">{numFmt.format(dt)}</span>
                  <span className="block text-[10px] opacity-70">{monthFmt.format(dt)}</span>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      <div className="glass min-h-[168px] rounded-3xl p-5">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <Clock className="h-3.5 w-3.5" /> Time slots
        </p>

        {!selectedDay ? (
          <p className="mt-3 text-sm text-muted-foreground">Pick an open date to see times.</p>
        ) : slotsError ? (
          <p className="mt-3 text-sm font-medium text-destructive">{slotsError}</p>
        ) : loadingSlots && !slots?.length ? (
          // Skeletons rather than a one-line spinner: the panel keeps roughly
          // the height it will have, so nothing jumps when the slots land.
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-[46px] animate-pulse rounded-2xl bg-secondary/50" />
            ))}
          </div>
        ) : !slots?.length ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No times left on that day — try another date.
          </p>
        ) : (
          <div
            className={`mt-4 grid grid-cols-2 gap-2.5 transition-opacity duration-150 sm:grid-cols-4 ${
              loadingSlots ? "opacity-50" : "opacity-100"
            }`}
          >
            {slots.map((s) => {
              const active = s.startTime === time;
              return (
                <button
                  key={s.startTime}
                  type="button"
                  onClick={() => onTime(s.startTime)}
                  className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition-[background-color,border-color,transform] duration-150 hover:-translate-y-0.5 active:translate-y-0 ${
                    active
                      ? "border-transparent text-primary-foreground"
                      : "border-border bg-card text-foreground hover:border-primary/50"
                  }`}
                  style={
                    active
                      ? { backgroundImage: "var(--gradient-brand)", boxShadow: "var(--shadow-glow)" }
                      : {}
                  }
                >
                  {formatTime12h(s.startTime)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
