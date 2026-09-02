import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  MapPin,
  XCircle,
} from "lucide-react";

import {
  cancelOwnBooking,
  getManagedBooking,
  getManagedBookingDays,
  getManagedBookingSlots,
  rescheduleOwnBooking,
} from "@/lib/api/manage.functions";

export const Route = createFileRoute("/manage/$token")({
  component: ManageBooking,
});

type Data = Awaited<ReturnType<typeof getManagedBooking>>;
type Day = Awaited<ReturnType<typeof getManagedBookingDays>>["days"][number];

const money = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;

function prettyDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function time12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${period}`;
}

const card = "glass rounded-3xl p-5 sm:p-7";

function ManageBooking() {
  const { token } = Route.useParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<"view" | "move" | "cancel">("view");
  const [days, setDays] = useState<Day[] | null>(null);
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<{ startTime: string }[] | null>(null);
  const [pickedTime, setPickedTime] = useState<string | null>(null);
  const [feeLink, setFeeLink] = useState<{ fee: number; url: string } | null>(null);
  const [done, setDone] = useState<"moved" | "cancelled" | null>(null);

  const load = useCallback(() => {
    getManagedBooking({ data: { token } })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load that booking."));
  }, [token]);

  useEffect(load, [load]);

  // Slots for a chosen day.
  useEffect(() => {
    if (!pickedDate) return;
    setSlots(null);
    setPickedTime(null);
    getManagedBookingSlots({ data: { token, date: pickedDate } })
      .then((r) => setSlots(r.slots))
      .catch(() => setSlots([]));
  }, [pickedDate, token]);

  if (error) {
    return (
      <Shell>
        <div className={card}>
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <div className={`${card} flex items-center gap-2 text-sm text-muted-foreground`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Finding your booking…
        </div>
      </Shell>
    );
  }

  if (!data.found) {
    return (
      <Shell>
        <div className={card}>
          <p className="text-lg font-semibold text-foreground">We couldn't find that booking.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The link may have expired or been mistyped. Get in touch and we'll sort it out.
          </p>
        </div>
      </Shell>
    );
  }

  const { booking, business, policy, cancellation, reschedule } = data;
  const cancelled = booking.status === "cancelled";

  const openMove = async () => {
    setMode("move");
    if (days) return;
    const r = await getManagedBookingDays({ data: { token } }).catch(() => ({ days: [] }));
    setDays(r.days);
  };

  const confirmMove = async () => {
    if (!pickedDate || !pickedTime) return;
    setBusy(true);
    setError(null);
    try {
      await rescheduleOwnBooking({ data: { token, date: pickedDate, startTime: pickedTime } });
      setDone("moved");
      setMode("view");
      setDays(null);
      setPickedDate(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't move that booking.");
    } finally {
      setBusy(false);
    }
  };

  const confirmCancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await cancelOwnBooking({ data: { token } });
      if (res.needsPayment) {
        // A fee is owed. Send them to Stripe; the page picks the payment up
        // when they come back, and the cancellation goes through then.
        setFeeLink({ fee: res.fee, url: res.url });
      } else {
        setDone("cancelled");
        setMode("view");
        load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't cancel that booking.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      {done && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 flex items-center gap-2 rounded-2xl bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4" />
          {done === "moved" ? "Your booking has been moved." : "Your booking has been cancelled."}
        </motion.div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              {cancelled ? "Cancelled" : "Your booking"}
            </p>
            <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {booking.serviceTitle}
            </h1>
            {booking.customerName && (
              <p className="mt-1 text-sm text-muted-foreground">for {booking.customerName}</p>
            )}
          </div>
          <span className="rounded-lg bg-secondary/70 px-3 py-1.5 text-xs font-semibold text-foreground">
            {booking.reference}
          </span>
        </div>

        <div className={`mt-6 grid gap-3 sm:grid-cols-2 ${cancelled ? "opacity-60" : ""}`}>
          <Row icon={CalendarDays} label={prettyDate(booking.date)} />
          <Row
            icon={Clock}
            label={`${time12h(booking.startTime)} · ${Math.round((booking.durationMinutes / 60) * 10) / 10} hr`}
          />
          <Row
            icon={MapPin}
            label={booking.location === "mobile" ? (booking.address ?? "Mobile") : "At the shop"}
          />
          <Row icon={CreditCard} label={`${money(booking.totalPrice)} total`} />
        </div>

        {booking.addOnTitles.length > 0 && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Add-ons: {booking.addOnTitles.join(", ")}
          </p>
        )}

        {/* Deposit state, only once there is one. */}
        {booking.depositAmount > 0 && (
          <div className="mt-5 rounded-2xl border border-border px-4 py-3.5">
            {booking.depositPaid ? (
              <p className="flex items-center gap-2 text-[13px] font-semibold text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Deposit of {money(booking.depositAmount)} received. Thank you.
              </p>
            ) : (
              <>
                <p className="text-[13px] font-semibold text-foreground">
                  Deposit of {money(booking.depositAmount)} outstanding
                </p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  The balance of {money(booking.totalPrice - booking.depositAmount)} is due on the
                  day.
                </p>
                {booking.depositUrl && !cancelled && (
                  <a
                    href={booking.depositUrl}
                    className="mt-3 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-primary-foreground"
                    style={{ backgroundImage: "var(--gradient-brand)" }}
                  >
                    <CreditCard className="h-4 w-4" /> Pay the deposit
                  </a>
                )}
              </>
            )}
          </div>
        )}

        {policy && !cancelled && (
          <p className="mt-5 text-[12.5px] leading-relaxed text-muted-foreground">{policy}</p>
        )}
      </div>

      {/* ---------------------------- actions --------------------------- */}
      {!cancelled && mode === "view" && (
        <div className="mt-4 flex flex-wrap gap-2.5">
          {reschedule.allowed && (
            <button
              type="button"
              onClick={openMove}
              className="rounded-full px-6 py-3 text-sm font-semibold text-primary-foreground"
              style={{ backgroundImage: "var(--gradient-brand)" }}
            >
              Change the time
            </button>
          )}
          {cancellation.kind !== "unavailable" && (
            <button
              type="button"
              onClick={() => setMode("cancel")}
              className="rounded-full border border-border px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:border-destructive/60 hover:text-destructive"
            >
              Cancel booking
            </button>
          )}
        </div>
      )}

      {/* Reasons, when an action isn't offered. */}
      {!cancelled && mode === "view" && (!reschedule.allowed || cancellation.kind === "unavailable") && (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          {reschedule.reason ??
            (cancellation.kind === "unavailable" ? cancellation.reason : "")}{" "}
          {business.phone && <>Call {business.phone} and we'll help.</>}
        </p>
      )}

      {/* ---------------------------- move ------------------------------ */}
      {mode === "move" && (
        <div className={`${card} mt-4`}>
          <p className="text-sm font-semibold text-foreground">Pick a new day</p>
          {!days ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking what's open…
            </p>
          ) : days.filter((d) => d.available).length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Nothing open in the next few weeks. Give us a call and we'll find something.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {days
                .filter((d) => d.available)
                .map((d) => (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setPickedDate(d.date)}
                    className={`rounded-2xl border px-2 py-3 text-center text-[13px] transition-colors ${
                      pickedDate === d.date
                        ? "border-transparent text-primary-foreground"
                        : "border-border bg-card text-foreground hover:border-primary/50"
                    }`}
                    style={
                      pickedDate === d.date
                        ? { backgroundImage: "var(--gradient-brand)" }
                        : undefined
                    }
                  >
                    {new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </button>
                ))}
            </div>
          )}

          {pickedDate && (
            <>
              <p className="mt-6 text-sm font-semibold text-foreground">Pick a time</p>
              {!slots ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading times…
                </p>
              ) : slots.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No times left that day.</p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {slots.map((s) => (
                    <button
                      key={s.startTime}
                      type="button"
                      onClick={() => setPickedTime(s.startTime)}
                      className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition-colors ${
                        pickedTime === s.startTime
                          ? "border-transparent text-primary-foreground"
                          : "border-border bg-card text-foreground hover:border-primary/50"
                      }`}
                      style={
                        pickedTime === s.startTime
                          ? { backgroundImage: "var(--gradient-brand)" }
                          : undefined
                      }
                    >
                      {time12h(s.startTime)}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="mt-6 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => setMode("view")}
              className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-foreground"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!pickedDate || !pickedTime || busy}
              onClick={confirmMove}
              className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              style={{ backgroundImage: "var(--gradient-brand)" }}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirm new time
            </button>
          </div>
        </div>
      )}

      {/* --------------------------- cancel ----------------------------- */}
      {mode === "cancel" && (
        <div className={`${card} mt-4`}>
          {feeLink ? (
            <>
              <p className="text-sm font-semibold text-foreground">
                A {money(feeLink.fee)} late cancellation fee applies
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                Pay the fee and your booking is cancelled straight after. Come back to this page
                once you've paid — it updates on its own.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <a
                  href={feeLink.url}
                  className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-primary-foreground"
                  style={{ backgroundImage: "var(--gradient-brand)" }}
                >
                  <CreditCard className="h-4 w-4" /> Pay {money(feeLink.fee)}
                </a>
                <button
                  type="button"
                  onClick={confirmCancel}
                  disabled={busy}
                  className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-foreground disabled:opacity-50"
                >
                  I've paid — cancel it
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <XCircle className="h-4 w-4 text-destructive" /> Cancel this booking?
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {cancellation.kind === "fee"
                  ? `Your appointment is close enough that a ${money(cancellation.fee)} late cancellation fee applies. You'll be taken to a secure payment page, and the booking is cancelled once it goes through.`
                  : cancellation.kind === "locked"
                    ? `It's too close to your appointment to cancel online. Please call ${business.phone || "us"}.`
                    : "There's nothing to pay. Your slot goes back on the calendar straight away."}
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => setMode("view")}
                  className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-foreground"
                >
                  Keep my booking
                </button>
                {cancellation.kind !== "locked" && (
                  <button
                    type="button"
                    onClick={confirmCancel}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-full bg-destructive px-6 py-2.5 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {cancellation.kind === "fee" ? "Continue to payment" : "Yes, cancel it"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <p className="mt-6 text-center text-[12.5px] text-muted-foreground">
        Questions? {business.phone && <>Call {business.phone}</>}
        {business.phone && business.email && " · "}
        {business.email && <>Email {business.email}</>}
      </p>
    </Shell>
  );
}

function Row({ icon: Icon, label }: { icon: typeof Clock; label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-foreground">
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to site
        </Link>
        {children}
      </div>
    </div>
  );
}
