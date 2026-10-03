import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarRange, Plus, Trash2 } from "lucide-react";

import { getAdminSettings, saveAvailability } from "@/lib/api/admin.functions";
import { WeekEditor } from "./ScheduleCard";
import { Button, ErrorNote, Field, GlassCard, Spinner, SuccessNote, Toggle, inputCls } from "./ui";

type Settings = Awaited<ReturnType<typeof getAdminSettings>>["settings"];
type Range = Settings["availabilityRanges"][number];

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const pretty = (iso: string) => (iso ? fmt.format(new Date(`${iso}T12:00:00`)) : "…");

/**
 * Availability by date: ranges like "June 1 – July 20", each optionally with
 * its own weekly hours. With "only inside these ranges" on, every other date
 * is closed; off, ranges just change the hours for the dates they cover.
 */
export function AvailabilityRangesCard() {
  const [ranges, setRanges] = useState<Range[] | null>(null);
  const [only, setOnly] = useState(false);
  const [baseWeek, setBaseWeek] = useState<Settings["weeklySchedule"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAdminSettings()
      .then(({ settings: s }) => {
        setRanges(s.availabilityRanges ?? []);
        setOnly(Boolean(s.onlyInRanges));
        setBaseWeek(s.weeklySchedule);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
  }, []);

  if (!ranges || !baseWeek) {
    return error ? <ErrorNote>{error}</ErrorNote> : <Spinner label="Loading availability…" />;
  }

  const update = (id: string, patch: Partial<Range>) =>
    setRanges(ranges.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const add = () =>
    setRanges([
      ...ranges,
      { id: crypto.randomUUID().slice(0, 8), label: "", start: "", end: "", schedule: null },
    ]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await saveAvailability({ data: { onlyInRanges: only, availabilityRanges: ranges } });
      setRanges(res.settings.availabilityRanges);
      setOnly(res.settings.onlyInRanges);
      setOk("Availability saved. The booking calendar uses it straight away.");
      setTimeout(() => setOk(null), 3500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard index={6} className="p-6 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <CalendarRange className="h-4 w-4 text-primary" />
            <p className="text-[15px] font-semibold tracking-tight text-foreground">
              Availability by date
            </p>
          </div>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
            Set date ranges, like June 1 to July 20, and optionally give each its own days and
            hours. Days off inside a range still come from Time off and your calendar.
          </p>
        </div>
        <Button variant="primary" loading={busy} onClick={save}>
          Save availability
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

      <div className="mt-5">
        <Toggle
          checked={only}
          onChange={setOnly}
          label="Only take bookings inside these ranges"
          hint="On: every date outside your ranges is closed. Off: ranges only change the hours for the dates they cover; everything else follows your weekly schedule."
        />
      </div>

      <div className="mt-5 space-y-3">
        {ranges.length === 0 && (
          <p className="rounded-xl border border-dashed border-[var(--line-2)] px-4 py-5 text-center text-[13px] text-muted-foreground">
            No ranges yet. Add one to open for a stretch of dates or set special hours.
          </p>
        )}

        <AnimatePresence initial={false}>
          {ranges.map((r) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-[var(--line-2)] bg-[var(--fill-1)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-[13.5px] font-semibold text-foreground">
                    {r.label || "Range"}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {pretty(r.start)} – {pretty(r.end)}
                    </span>
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRanges(ranges.filter((x) => x.id !== r.id))}
                    aria-label="Remove this range"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="Name (optional)">
                    <input
                      className={inputCls}
                      value={r.label}
                      maxLength={60}
                      placeholder="Summer"
                      onChange={(e) => update(r.id, { label: e.target.value })}
                    />
                  </Field>
                  <Field label="Starts">
                    <input
                      className={inputCls}
                      type="date"
                      value={r.start}
                      onChange={(e) => update(r.id, { start: e.target.value })}
                    />
                  </Field>
                  <Field label="Ends">
                    <input
                      className={inputCls}
                      type="date"
                      value={r.end}
                      min={r.start || undefined}
                      onChange={(e) => update(r.id, { end: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="mt-4">
                  <Toggle
                    checked={Boolean(r.schedule)}
                    onChange={(on) =>
                      update(r.id, { schedule: on ? baseWeek.map((d) => ({ ...d })) : null })
                    }
                    label="Custom days and hours for this range"
                    hint="Off: these dates use your regular weekly schedule."
                  />
                </div>

                <AnimatePresence initial={false}>
                  {r.schedule && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <div className="pt-4">
                        <WeekEditor
                          week={r.schedule}
                          onChange={(week) => update(r.id, { schedule: week })}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <Button className="mt-4" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add a date range
      </Button>
    </GlassCard>
  );
}
