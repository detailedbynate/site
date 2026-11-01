import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Camera,
  Car,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  CreditCard,
  MapPin,
  Navigation,
  Phone,
  MessageSquare,
  Sparkles,
  Store,
} from "lucide-react";

import { finishJob, getJob, saveJob, startJob } from "@/lib/api/jobs.functions";
import { setBookingStatus } from "@/lib/api/admin.functions";
import { Button, ErrorNote, Spinner, money } from "@/components/admin/ui";
import { PhotoUploader } from "@/components/admin/PhotoUploader";
import { clock, duration, fmt, jobColor, range, toMinutes, vehicleLine } from "@/components/admin/calendar/model";

/*
  Job mode: one booking, start to finish, on the driveway.

    0 Arrive        details, directions, "on my way" text, then "I'm here"
    1 Before photos the car as it arrived
    2 Checklist     what the package promises, ticked off as you go
    3 After photos  the result
    4 Finish        tip, payment, mark complete

  The same shape as Jobber's "start visit" and the detailing apps: a timer
  from the moment you arrive, one clear button per step, and everything saved
  as you go — close the app mid-job and it reopens on the same step with the
  same boxes ticked.
*/

export const Route = createFileRoute("/admin/job/$id")({
  component: JobPage,
});

type Job = Awaited<ReturnType<typeof getJob>>;

const STEPS = [
  { label: "Arrive", icon: MapPin },
  { label: "Before", icon: Camera },
  { label: "Checklist", icon: ClipboardCheck },
  { label: "After", icon: Sparkles },
  { label: "Finish", icon: CreditCard },
] as const;

const METHODS = ["Cash", "E-transfer", "Card", "Other"];

function elapsed(fromISO: string | undefined, toISO?: string): number {
  if (!fromISO) return 0;
  return Math.max(0, Math.round(((toISO ? Date.parse(toISO) : Date.now()) - Date.parse(fromISO)) / 60000));
}

function JobPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStepState] = useState(0);
  const [dir, setDir] = useState(1);
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      const j = await getJob({ data: { id } });
      setJob(j);
      setDone(j.booking.jobChecklist ?? []);
      // Resume where it was left. A finished job opens on its summary.
      setStepState(j.booking.jobFinishedAt || j.booking.status === "completed" ? 4 : (j.booking.jobStep ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this job.");
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  // The timer only needs the minute; a 15s tick keeps it honest cheaply.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const go = (next: number) => {
    setDir(next > step ? 1 : -1);
    setStepState(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
    void saveJob({ data: { id, step: next } }).catch(() => undefined);
  };

  // Checklist ticks save after a short pause, so tapping through five items
  // is one request, not five — and never blocks the tap itself.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toggle = (item: string) => {
    setDone((prev) => {
      const next = prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item];
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void saveJob({ data: { id, checklist: next } }).catch(() => undefined), 500);
      return next;
    });
    if ("vibrate" in navigator) navigator.vibrate?.(8);
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!job) return <Spinner label="Opening job…" />;

  const b = job.booking;
  const start = toMinutes(b.startTime);
  const name = job.client?.name ?? "Client";
  const first = name.split(" ")[0];
  const phone = job.client?.phone?.replace(/[^\d+]/g, "");
  const mapsUrl =
    b.location === "mobile" && b.address
      ? `https://maps.apple.com/?daddr=${encodeURIComponent(b.address)}`
      : null;
  const minutes = elapsed(b.jobStartedAt, b.jobFinishedAt);
  const finished = Boolean(b.jobFinishedAt) || b.status === "completed";
  const onMyWay = `sms:${phone}&body=${encodeURIComponent(
    `Hi ${first}, it's ${job.businessName} — I'm on my way and will see you around ${clock(start)}.`,
  )}`;

  const begin = async () => {
    setBusy(true);
    try {
      const r = await startJob({ data: { id } });
      if (r.booking) setJob({ ...job, booking: r.booking });
      go(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the job.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl pb-10">
      {/* Header: who, what, and the running clock. */}
      <div className="mb-4 flex items-center gap-3">
        <Link
          to="/admin/calendar"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line-2)] bg-[var(--fill-1)] text-foreground"
          aria-label="Back to calendar"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-muted-foreground">
            {fmt(b.date, { weekday: "short", month: "short", day: "numeric" })} ·{" "}
            {range(start, start + b.durationMinutes)} · {b.reference}
          </p>
          <h1 className="truncate text-[22px] font-bold tracking-tight text-foreground">{name}</h1>
        </div>
        {b.jobStartedAt && (
          <span
            className={`tnum flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${
              finished ? "bg-emerald-500/15 text-emerald-500" : "bg-primary/15 text-primary"
            }`}
          >
            {!finished && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
            <Clock className="h-3.5 w-3.5" /> {duration(minutes || 1)}
          </span>
        )}
      </div>

      {/* Stepper: where you are, and tap back to any earlier step. */}
      <ol className="mb-5 grid grid-cols-5 gap-1.5">
        {STEPS.map((s, i) => {
          const reached = i <= step || (i > 0 && !!b.jobStartedAt && i <= (b.jobStep ?? 0));
          const active = i === step;
          return (
            <li key={s.label}>
              <button
                type="button"
                disabled={!reached || (i > 0 && !b.jobStartedAt)}
                onClick={() => go(i)}
                className="group flex w-full flex-col items-center gap-1.5 disabled:cursor-default"
              >
                <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--fill-3)]">
                  <motion.span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ backgroundImage: "var(--gradient-brand)" }}
                    initial={false}
                    animate={{ width: i < step || finished ? "100%" : active ? "50%" : "0%" }}
                    transition={{ type: "spring", stiffness: 300, damping: 34 }}
                  />
                </span>
                <span
                  className={`text-[11px] font-semibold ${active ? "text-foreground" : reached ? "text-muted-foreground" : "text-muted-foreground/50"}`}
                >
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.div
          key={step}
          custom={dir}
          initial={{ opacity: 0, x: dir * 36 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -36 }}
          transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.7 }}
        >
          {step === 0 && (
            <Section title="Arrive" subtitle="Everything you need before you knock.">
              <div
                className="cal-job rounded-2xl px-4 py-3.5"
                style={{ "--c": jobColor(b) } as CSSProperties}
              >
                <p className="tnum cal-ink text-[12px] font-semibold">
                  {range(start, start + b.durationMinutes)} · {duration(b.durationMinutes)}
                </p>
                <p className="mt-0.5 text-[17px] font-bold tracking-tight text-foreground">{b.serviceTitle}</p>
                {b.addOnTitles?.length ? (
                  <p className="text-[12.5px] text-muted-foreground">+ {b.addOnTitles.join(", ")}</p>
                ) : null}
              </div>

              <div className="mt-3 space-y-2">
                <Row icon={b.location === "mobile" ? MapPin : Store}>
                  {b.location === "mobile" ? b.address || "Mobile — no address given" : "Drop-off at the shop"}
                </Row>
                {vehicleLine(b) && <Row icon={Car}>{vehicleLine(b)}</Row>}
                {b.notes && (
                  <p className="whitespace-pre-line rounded-xl bg-amber-400/[0.08] px-3 py-2.5 text-[13px] text-foreground">
                    {b.notes}
                  </p>
                )}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {mapsUrl && (
                  <a href={mapsUrl} target="_blank" rel="noreferrer" className="cal-quick">
                    <Navigation className="h-4 w-4" /> Directions
                  </a>
                )}
                {phone && (
                  <a href={onMyWay} className="cal-quick">
                    <MessageSquare className="h-4 w-4" /> On my way
                  </a>
                )}
                {phone && (
                  <a href={`tel:${phone}`} className="cal-quick">
                    <Phone className="h-4 w-4" /> Call
                  </a>
                )}
              </div>

              <Primary busy={busy} onClick={b.jobStartedAt ? () => go(1) : begin}>
                {b.jobStartedAt ? "Continue job" : "I'm here — start job"}
              </Primary>
            </Section>
          )}

          {step === 1 && (
            <Section title="Before photos" subtitle="Each side, the wheels, the interior — and any damage up close.">
              <PhotoUploader bookingId={id} defaultKind="before" />
              <Primary onClick={() => go(2)}>Next: checklist</Primary>
            </Section>
          )}

          {step === 2 && (
            <Section
              title="Checklist"
              subtitle={`${done.filter((d) => job.checklist.includes(d)).length} of ${job.checklist.length} done`}
            >
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[var(--fill-3)]">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundImage: "var(--gradient-brand)" }}
                  animate={{
                    width: `${(done.filter((d) => job.checklist.includes(d)).length / Math.max(1, job.checklist.length)) * 100}%`,
                  }}
                  transition={{ type: "spring", stiffness: 260, damping: 30 }}
                />
              </div>
              <ul className="space-y-2">
                {job.checklist.map((item) => {
                  const on = done.includes(item);
                  return (
                    <li key={item}>
                      <button
                        type="button"
                        onClick={() => toggle(item)}
                        className={`cal-press flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors ${
                          on
                            ? "border-emerald-500/30 bg-emerald-500/[0.08]"
                            : "border-[var(--line-2)] bg-[var(--fill-1)]"
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                            on ? "border-emerald-500 bg-emerald-500 text-white" : "border-[var(--line-3)]"
                          }`}
                        >
                          <AnimatePresence>
                            {on && (
                              <motion.span
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                exit={{ scale: 0 }}
                                transition={{ type: "spring", stiffness: 600, damping: 26 }}
                              >
                                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </span>
                        <span
                          className={`text-[14px] transition-colors ${on ? "text-muted-foreground line-through" : "text-foreground"}`}
                        >
                          {item}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Primary onClick={() => go(3)}>Next: after photos</Primary>
            </Section>
          )}

          {step === 3 && (
            <Section title="After photos" subtitle="Same angles as before — these make the best before/afters.">
              <PhotoUploader bookingId={id} defaultKind="after" />
              <Primary onClick={() => go(4)}>Next: finish</Primary>
            </Section>
          )}

          {step === 4 &&
            (finished ? (
              <Summary job={job} minutes={minutes} checked={done.length} onBack={() => navigate({ to: "/admin/calendar" })} />
            ) : (
              <FinishStep
                job={job}
                busy={busy}
                onFinish={async (paid, tip, method) => {
                  setBusy(true);
                  try {
                    await finishJob({ data: { id, paid, tip, method } });
                    // Completion through the normal path: calendar, webhooks
                    // and emails behave exactly as from Appointments.
                    await setBookingStatus({ data: { bookingId: id, status: "completed" } });
                    await load();
                    if ("vibrate" in navigator) navigator.vibrate?.([10, 40, 10]);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Couldn't finish the job.");
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="liquid-glass rounded-3xl p-5">
      <h2 className="text-[18px] font-bold tracking-tight text-foreground">{title}</h2>
      <p className="mb-4 mt-0.5 text-[12.5px] text-muted-foreground">{subtitle}</p>
      {children}
    </section>
  );
}

function Row({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 text-[14px] text-foreground">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{children}</span>
    </p>
  );
}

/** The one big button each step ends with — thumb-sized, always in the same place. */
function Primary({ children, onClick, busy = false }: { children: React.ReactNode; onClick: () => void; busy?: boolean }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      disabled={busy}
      onClick={onClick}
      style={{ backgroundImage: "var(--gradient-brand)" }}
      className="mt-5 flex w-full items-center justify-center gap-2 rounded-full py-4 text-[15.5px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] disabled:opacity-60"
    >
      {busy ? "Working…" : children}
    </motion.button>
  );
}

function FinishStep({
  job,
  busy,
  onFinish,
}: {
  job: Job;
  busy: boolean;
  onFinish: (paid: boolean, tip: number, method?: string) => void;
}) {
  const [tip, setTip] = useState(0);
  const [method, setMethod] = useState<string | null>(null);
  const base = job.owed;
  const presets = [0, 0.1, 0.15, 0.2].map((p) => Math.round(base * p));
  const total = base + tip;

  return (
    <Section title="Finish" subtitle="Take payment, then close the job.">
      <div className="rounded-2xl border border-[var(--line-2)] bg-[var(--fill-1)] p-4 text-center">
        <p className="text-[12px] text-muted-foreground">{base > 0 ? "Amount due" : "Already paid in full"}</p>
        <p className="tnum mt-0.5 text-[34px] font-bold tracking-tight text-foreground">{money(total)}</p>
        {tip > 0 && <p className="tnum text-[12px] text-muted-foreground">incl. {money(tip)} tip</p>}
      </div>

      <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tip</p>
      <div className="grid grid-cols-4 gap-2">
        {presets.map((t, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setTip(t)}
            className={`cal-press rounded-xl border py-2.5 text-[13px] font-semibold ${
              tip === t ? "border-primary bg-primary/15 text-primary" : "border-[var(--line-2)] bg-[var(--fill-1)] text-foreground"
            }`}
          >
            {i === 0 ? "None" : `${[0, 10, 15, 20][i]}%`}
          </button>
        ))}
      </div>

      <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Paid by</p>
      <div className="grid grid-cols-4 gap-2">
        {METHODS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`cal-press rounded-xl border py-2.5 text-[12.5px] font-semibold ${
              method === m ? "border-primary bg-primary/15 text-primary" : "border-[var(--line-2)] bg-[var(--fill-1)] text-foreground"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <Primary busy={busy} onClick={() => onFinish(true, tip, method ?? undefined)}>
        <CheckCircle2 className="h-5 w-5" /> {base > 0 ? `Paid ${money(total)} — finish job` : "Finish job"}
      </Primary>
      {base > 0 && (
        <Button className="mt-2 w-full" disabled={busy} onClick={() => onFinish(false, tip)}>
          Not paid yet — finish anyway
        </Button>
      )}
    </Section>
  );
}

function Summary({
  job,
  minutes,
  checked,
  onBack,
}: {
  job: Job;
  minutes: number;
  checked: number;
  onBack: () => void;
}) {
  const b = job.booking;
  return (
    <section className="liquid-glass rounded-3xl p-6 text-center">
      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 18 }}
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white"
      >
        <Check className="h-8 w-8" strokeWidth={3} />
      </motion.div>
      <h2 className="mt-4 text-[22px] font-bold tracking-tight text-foreground">Job done</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {b.serviceTitle} for {job.client?.name ?? "the customer"}
      </p>
      <div className="mt-5 grid grid-cols-3 gap-2 text-left">
        <Stat label="Time on site" value={minutes ? duration(minutes) : "< 1m"} />
        <Stat label="Checklist" value={`${checked}/${job.checklist.length}`} />
        <Stat label="Payment" value={b.paymentStatus === "paid" ? "Paid" : money(job.owed) + " due"} />
      </div>
      <div className="mt-5 grid gap-2">
        <Button variant="primary" onClick={onBack}>
          Back to calendar
        </Button>
        <Link to="/admin/appointments" className="block">
          <Button className="w-full">Open in Appointments</Button>
        </Link>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line-2)] bg-[var(--fill-1)] px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="tnum mt-0.5 text-[15px] font-bold text-foreground">{value}</p>
    </div>
  );
}
