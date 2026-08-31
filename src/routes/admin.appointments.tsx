import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarDays,
  CalendarPlus,
  Car,
  Check,
  Clock,
  Mail,
  MapPin,
  Phone,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import {
  getRescheduleOptions,
  listAppointments,
  removeAppointment,
  rescheduleAppointment,
  setBookingStatus,
} from "@/lib/api/admin.functions";
import { PhotoUploader } from "@/components/admin/PhotoUploader";
import {
  Avatar,
  Button,
  DetailField,
  DetailGroup,
  DetailPanel,
  EmptyState,
  ErrorNote,
  Field,
  ListRow,
  PageHeader,
  Spinner,
  StatusPill,
  hours,
  inputCls,
  money,
  prettyDate,
  time12h,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/appointments")({
  component: Appointments,
});

type Row = Awaited<ReturnType<typeof listAppointments>>["bookings"][number];
type Filter = "all" | "confirmed" | "completed" | "cancelled";

function Appointments() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<Row | null>(null);

  const load = async () => {
    try {
      const res = await listAppointments();
      setRows(res.bookings);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load appointments.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter((b) => {
      if (filter !== "all" && b.status !== filter) return false;
      if (!q) return true;
      return [b.reference, b.client?.name, b.client?.email, b.client?.phone, b.serviceTitle, b.address]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  const counts = useMemo(() => {
    const c = { all: 0, confirmed: 0, completed: 0, cancelled: 0 };
    for (const b of rows ?? []) {
      c.all += 1;
      c[b.status] += 1;
    }
    return c;
  }, [rows]);

  const open = rows?.find((b) => b.id === openId) ?? null;

  if (!rows && !error) return <Spinner label="Loading appointments…" />;

  return (
    <>
      <PageHeader
        title="Appointments"
        subtitle="Click any booking to see everything. Cancelling frees its slot for new bookings straight away."
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-0.5 rounded-xl bg-white/[0.04] p-1 ring-1 ring-inset ring-white/[0.06]">
          {(["all", "confirmed", "completed", "cancelled"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`relative rounded-lg px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors ${
                filter === f ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {filter === f && (
                <motion.span
                  layoutId="appt-filter"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="absolute inset-0 -z-10 rounded-lg bg-white/[0.09] ring-1 ring-inset ring-white/[0.08]"
                />
              )}
              {f}
              <span className="ml-1.5 tnum opacity-50">{counts[f]}</span>
            </button>
          ))}
        </div>

        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Search name, ref, phone, address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <AnimatePresence>{error && <ErrorNote>{error}</ErrorNote>}</AnimatePresence>

      {filtered.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={CalendarDays}
            title={rows?.length ? "Nothing matches" : "No appointments yet"}
            body={
              rows?.length
                ? "Try a different filter or search term."
                : "Bookings made on the site appear here automatically."
            }
          />
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {filtered.map((b, i) => (
              <ListRow
                key={b.id}
                index={i}
                muted={b.status === "cancelled"}
                onClick={() => setOpenId(b.id)}
              >
                <Avatar name={b.client?.name ?? "?"} />

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-[14px] font-semibold text-foreground">
                      {b.client?.name ?? "—"}
                    </span>
                    <span className="tnum rounded-md bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {b.reference}
                    </span>
                    <StatusPill status={b.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {prettyDate(b.date)} · {time12h(b.startTime)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      {b.serviceTitle}
                      {b.addOnTitles?.length ? ` +${b.addOnTitles.length}` : ""}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {b.location === "mobile" ? "Mobile" : "Shop"}
                    </span>
                    <span className="hidden items-center gap-1 sm:inline-flex">
                      <Clock className="h-3 w-3" />
                      {hours(b.durationMinutes)}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <span className="tnum text-[15px] font-bold text-foreground">
                    {money(b.totalPrice ?? 0)}
                  </span>
                  <span className="hidden text-muted-foreground/40 transition-colors group-hover:text-primary sm:block">
                    ›
                  </span>
                </div>
              </ListRow>
            ))}
          </AnimatePresence>
        </div>
      )}

      <DetailPanel
        open={!!open}
        onClose={() => setOpenId(null)}
        eyebrow={open ? `${open.reference} · booked ${new Date(open.createdAt).toLocaleDateString()}` : ""}
        title={open?.client?.name ?? ""}
        footer={
          open && (
            <div className="flex flex-wrap gap-2">
              {open.status === "confirmed" && (
                <>
                  <Button
                    variant="primary"
                    loading={busy}
                    onClick={() =>
                      act(() =>
                        setBookingStatus({ data: { bookingId: open.id, status: "completed" } }),
                      )
                    }
                  >
                    <Check className="h-3.5 w-3.5" /> Mark complete
                  </Button>
                  <Button onClick={() => setRescheduling(open)}>
                    <CalendarPlus className="h-3.5 w-3.5" /> Reschedule
                  </Button>
                </>
              )}
              {open.status !== "cancelled" ? (
                <Button
                  variant="danger"
                  loading={busy}
                  onClick={() =>
                    act(() =>
                      setBookingStatus({ data: { bookingId: open.id, status: "cancelled" } }),
                    )
                  }
                >
                  <X className="h-3.5 w-3.5" /> Cancel booking
                </Button>
              ) : (
                <>
                  <Button
                    loading={busy}
                    onClick={() =>
                      act(() =>
                        setBookingStatus({ data: { bookingId: open.id, status: "confirmed" } }),
                      )
                    }
                  >
                    <Undo2 className="h-3.5 w-3.5" /> Restore
                  </Button>
                  <Button
                    variant="ghost"
                    loading={busy}
                    onClick={() => {
                      if (!confirm(`Permanently delete ${open.reference}?`)) return;
                      setOpenId(null);
                      void act(() => removeAppointment({ data: { bookingId: open.id } }));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </>
              )}
            </div>
          )
        }
      >
        {open && (
          <>
            <div className="mb-6 flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-3 ring-1 ring-inset ring-white/[0.06]">
              <div>
                <p className="text-[11px] text-muted-foreground">Total</p>
                <p className="tnum text-2xl font-bold text-primary">
                  {money((open.totalPrice ?? 0) + (open.tip ?? 0))}
                </p>
                {!!open.tip && (
                  <p className="tnum text-[11px] text-emerald-300">incl. {money(open.tip)} tip</p>
                )}
              </div>
              <StatusPill status={open.status} />
            </div>

            <DetailGroup title="Appointment">
              <DetailField label="Date & time" icon={CalendarDays}>
                {prettyDate(open.date)} at {time12h(open.startTime)}
              </DetailField>
              <DetailField label="Duration" icon={Clock}>
                {hours(open.durationMinutes)} blocked on the calendar
              </DetailField>
              <DetailField label="Package" icon={Sparkles}>
                {open.serviceTitle}
              </DetailField>
              <DetailField label="Add-ons">
                {open.addOnTitles?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {open.addOnTitles.map((a) => (
                      <span
                        key={a}
                        className="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] font-medium"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </DetailField>
              <DetailField label="Location" icon={MapPin}>
                {open.location === "mobile" ? (
                  <>
                    Mobile service
                    <span className="mt-0.5 block text-muted-foreground">{open.address}</span>
                  </>
                ) : (
                  "At the shop"
                )}
              </DetailField>
            </DetailGroup>

            <DetailGroup title="Customer">
              <DetailField label="Name">{open.client?.name ?? "—"}</DetailField>
              <DetailField label="Email" icon={Mail}>
                <a
                  href={`mailto:${open.client?.email ?? ""}`}
                  className="text-primary hover:underline"
                >
                  {open.client?.email ?? "—"}
                </a>
              </DetailField>
              <DetailField label="Phone" icon={Phone}>
                <a href={`tel:${open.client?.phone ?? ""}`} className="text-primary hover:underline">
                  {open.client?.phone ?? "—"}
                </a>
              </DetailField>
            </DetailGroup>

            {open.vehicle && (
              <DetailGroup title="Vehicle">
                <DetailField label="Car" icon={Car}>
                  {open.vehicle.year} {open.vehicle.make} {open.vehicle.model}
                </DetailField>
                <DetailField label="Colour">{open.vehicle.color}</DetailField>
              </DetailGroup>
            )}

            <DetailGroup title="Vehicle photos">
              <PhotoUploader bookingId={open.id} />
            </DetailGroup>

            {(open.notes || open.cancelReason) && (
              <DetailGroup title="Notes">
                {open.notes && (
                  <DetailField label="Customer notes" icon={StickyNote}>
                    {open.notes}
                  </DetailField>
                )}
                {open.cancelReason && (
                  <DetailField label="Cancellation reason">{open.cancelReason}</DetailField>
                )}
              </DetailGroup>
            )}
          </>
        )}
      </DetailPanel>

      <RescheduleDialog
        booking={rescheduling}
        onClose={() => setRescheduling(null)}
        onDone={async () => {
          setRescheduling(null);
          await load();
        }}
      />
    </>
  );
}

function RescheduleDialog({
  booking,
  onClose,
  onDone,
}: {
  booking: Row | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<{ startTime: string }[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (booking) {
      setDate(booking.date);
      setPicked(null);
      setError(null);
    }
  }, [booking]);

  useEffect(() => {
    if (!booking || !date) return;
    let cancelled = false;
    setSlots(null);
    getRescheduleOptions({ data: { bookingId: booking.id, date } })
      .then((r) => !cancelled && setSlots(r.slots))
      .catch(() => !cancelled && setSlots([]));
    return () => {
      cancelled = true;
    };
  }, [booking, date]);

  const save = async () => {
    if (!booking || !picked) return;
    setBusy(true);
    setError(null);
    try {
      await rescheduleAppointment({ data: { bookingId: booking.id, date, startTime: picked } });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reschedule.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {booking && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="admin-theme fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]"
        >
          <motion.div
            initial={{ scale: 0.96, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.98, y: 8 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[var(--card)] p-6"
          >
            <h2 className="text-lg font-bold tracking-tight text-foreground">Reschedule</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {booking.reference} · {booking.serviceTitle} · {hours(booking.durationMinutes)}
            </p>

            <div className="mt-5">
              <Field label="New date">
                <input
                  type="date"
                  className={inputCls}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setPicked(null);
                  }}
                />
              </Field>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-[12px] font-medium text-muted-foreground">Available times</p>
              {!slots ? (
                <p className="text-[13px] text-muted-foreground">Checking…</p>
              ) : slots.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  Nothing open that day for a {hours(booking.durationMinutes)} job.
                </p>
              ) : (
                <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                  {slots.map((s) => (
                    <button
                      key={s.startTime}
                      type="button"
                      onClick={() => setPicked(s.startTime)}
                      className={`rounded-lg px-2 py-2 text-[12px] font-semibold ring-1 ring-inset transition ${
                        picked === s.startTime
                          ? "text-primary-foreground ring-transparent"
                          : "bg-white/[0.03] text-foreground ring-white/[0.09] hover:bg-white/[0.07]"
                      }`}
                      style={
                        picked === s.startTime
                          ? { backgroundImage: "var(--gradient-brand)" }
                          : undefined
                      }
                    >
                      {time12h(s.startTime)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <div className="mt-4">
                <ErrorNote>{error}</ErrorNote>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" loading={busy} disabled={!picked} onClick={save}>
                Move appointment
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
