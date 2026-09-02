import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarClock, Copy, Truck } from "lucide-react";

import { getAdminSettings, saveSchedule } from "@/lib/api/admin.functions";
import {
  Button,
  ErrorNote,
  Field,
  GlassCard,
  Spinner,
  SuccessNote,
  ToggleChip,
  inputCls,
} from "./ui";

type Settings = Awaited<ReturnType<typeof getAdminSettings>>["settings"];
type Week = Settings["weeklySchedule"];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** 13 -> "1 PM". Hour-granularity only, which is all the schedule needs. */
function hourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  if (h === 24) return "12 AM";
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}

function WeekEditor({
  week,
  onChange,
  disabled,
}: {
  week: Week;
  onChange: (next: Week) => void;
  disabled?: boolean;
}) {
  const set = (i: number, patch: Partial<Week[number]>) =>
    onChange(week.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  return (
    <div className={`space-y-1.5 ${disabled ? "pointer-events-none opacity-40" : ""}`}>
      {week.map((day, i) => (
        <div
          key={i}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line-1)] bg-[var(--fill-1)] px-3.5 py-2.5"
        >
          <span className="w-[84px] shrink-0 text-[13px] font-medium text-foreground">
            {DAYS[i]}
          </span>

          <ToggleChip
            on={day.open}
            labels={["Open", "Closed"]}
            onChange={(next) => set(i, { open: next })}
          />

          <AnimatePresence initial={false}>
            {day.open && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="flex items-center gap-2 overflow-hidden"
              >
                <select
                  value={day.openHour}
                  onChange={(e) => set(i, { openHour: Number(e.target.value) })}
                  className="rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-primary/60"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-muted-foreground">to</span>
                <select
                  value={day.closeHour}
                  onChange={(e) => set(i, { closeHour: Number(e.target.value) })}
                  className="rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-primary/60"
                >
                  {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
                {day.closeHour <= day.openHour && (
                  <span className="text-[11px] font-semibold text-destructive">
                    End must be later
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {day.open && (
            <button
              type="button"
              onClick={() =>
                onChange(
                  week.map((d) =>
                    d.open ? { ...d, openHour: day.openHour, closeHour: day.closeHour } : d,
                  ),
                )
              }
              title="Apply these hours to every open day"
              className="ml-auto rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-[var(--fill-3)] hover:text-foreground"
            >
              <Copy className="mr-1 inline h-3 w-3" />
              Apply to all
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function ScheduleCard() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await getAdminSettings();
      setS(res.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!s) return;
    setBusy(true);
    setError(null);
    try {
      const res = await saveSchedule({
        data: {
          weeklySchedule: s.weeklySchedule,
          mobileScheduleEnabled: s.mobileScheduleEnabled,
          mobileSchedule: s.mobileSchedule,
          slotIncrementMinutes: s.slotIncrementMinutes,
          leadDays: s.leadDays,
          bookingWindowDays: s.bookingWindowDays,
          bufferMinutes: s.bufferMinutes,
          maxJobsPerDay: s.maxJobsPerDay,
        },
      });
      setS(res.settings);
      setOk("Schedule saved. Booking availability updated.");
      setTimeout(() => setOk(null), 3500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  if (!s && !error) return <Spinner label="Loading schedule…" />;
  if (!s) return <ErrorNote>{error}</ErrorNote>;

  return (
    <GlassCard index={5} className="p-6 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <CalendarClock className="h-4 w-4 text-primary" />
            <p className="text-[15px] font-semibold tracking-tight text-foreground">Schedule</p>
          </div>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
            Your base weekly hours — the schedule <em>before</em> Google Calendar is applied.
            Calendar events and existing bookings only ever remove time from this; they never
            add any. If a day is closed here, nothing can be booked on it.
          </p>
        </div>
        <Button variant="primary" loading={busy} onClick={save}>
          Save schedule
        </Button>
      </div>

      <AnimatePresence>
        {error && (
          <div className="mt-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        {ok && (
          <div className="mt-4">
            <SuccessNote>{ok}</SuccessNote>
          </div>
        )}
      </AnimatePresence>

      <p className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Shop hours
      </p>
      <WeekEditor week={s.weeklySchedule} onChange={(w) => setS({ ...s, weeklySchedule: w })} />

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line-2)] pt-5">
        <div>
          <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <Truck className="h-3.5 w-3.5 text-primary" />
            Separate hours for mobile jobs
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Useful if travel or daylight means you run a shorter day on the road.
          </p>
        </div>
        <ToggleChip
          on={s.mobileScheduleEnabled}
          labels={["On", "Off"]}
          onChange={(next) => setS({ ...s, mobileScheduleEnabled: next })}
        />
      </div>

      <AnimatePresence initial={false}>
        {s.mobileScheduleEnabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="pt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Mobile hours
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setS({ ...s, mobileSchedule: s.weeklySchedule.map((d) => ({ ...d })) })
                  }
                  className="rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-[var(--fill-3)] hover:text-foreground"
                >
                  Copy from shop hours
                </button>
              </div>
              <WeekEditor
                week={s.mobileSchedule}
                onChange={(w) => setS({ ...s, mobileSchedule: w })}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-7 grid gap-4 border-t border-[var(--line-2)] pt-5 sm:grid-cols-3">
        <Field label="Slot step (minutes)" hint="How far apart start times are.">
          <input
            className={inputCls}
            type="number"
            min={15}
            step={15}
            value={s.slotIncrementMinutes}
            onChange={(e) => setS({ ...s, slotIncrementMinutes: Number(e.target.value) })}
          />
        </Field>
        <Field label="Notice required (days)" hint="0 = same-day booking allowed.">
          <input
            className={inputCls}
            type="number"
            min={0}
            value={s.leadDays}
            onChange={(e) => setS({ ...s, leadDays: Number(e.target.value) })}
          />
        </Field>
        <Field label="Book ahead (days)" hint="How far out the calendar goes.">
          <input
            className={inputCls}
            type="number"
            min={1}
            value={s.bookingWindowDays}
            onChange={(e) => setS({ ...s, bookingWindowDays: Number(e.target.value) })}
          />
        </Field>
        <Field
          label="Gap between jobs (minutes)"
          hint="Kept clear either side of every job, calendar event and block of time off — pack-up, travel and setup."
        >
          <input
            className={inputCls}
            type="number"
            min={0}
            step={15}
            value={s.bufferMinutes}
            onChange={(e) => setS({ ...s, bufferMinutes: Number(e.target.value) })}
          />
        </Field>
        <Field label="Max jobs per day" hint="0 = no limit. A hard cap, whatever the clock allows.">
          <input
            className={inputCls}
            type="number"
            min={0}
            value={s.maxJobsPerDay}
            onChange={(e) => setS({ ...s, maxJobsPerDay: Number(e.target.value) })}
          />
        </Field>
      </div>
    </GlassCard>
  );
}
