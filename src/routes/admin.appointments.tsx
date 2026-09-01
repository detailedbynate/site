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
  Pencil,
  Undo2,
  Upload,
  UserCog,
  X,
} from "lucide-react";

import {
  getRescheduleOptions,
  listAppointments,
  removeAppointment,
  rescheduleAppointment,
  setBookingStatus,
} from "@/lib/api/admin.functions";
import {
  assignAppointment,
  listAdminAgents,
  listAdminLocations,
} from "@/lib/api/operations.functions";
import { PhotoUploader, QuickPhotoCapture } from "@/components/admin/PhotoUploader";
import { TabBar } from "@/components/admin/TabBar";
import { EditorModal, FieldRow } from "@/components/admin/EditorModal";
import { AppointmentImport } from "@/components/admin/AppointmentImport";
import {
  getAppointmentDetail,
  updateAppointment,
} from "@/lib/api/appointments.functions";
import {
  Portal,
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
type Detail = Awaited<ReturnType<typeof getAppointmentDetail>>;
type EditDraft = {
  id: string;
  serviceId: string;
  addOnIds: string[];
  location: "mobile" | "shop";
  address: string;
  make: string;
  model: string;
  year: string;
  color: string;
  notes: string;
  overrideOn: boolean;
  price: number;
};
type Filter = "all" | "confirmed" | "completed" | "cancelled";

function Appointments() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<Row | null>(null);
  const [agents, setAgents] = useState<{ id: string; name: string; color: string }[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [importing, setImporting] = useState(false);
  const [photoRefresh, setPhotoRefresh] = useState(0);

  const load = async () => {
    try {
      const res = await listAppointments();
      setRows(res.bookings);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load appointments.");
    }
  };

  // Assignment options. Loaded separately so a failure here can never stop
  // the appointments list itself from rendering.
  useEffect(() => {
    void (async () => {
      try {
        const [a, l] = await Promise.all([listAdminAgents(), listAdminLocations()]);
        setAgents(a.agents.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, color: x.color })));
        setLocations(
          l.locations.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, kind: x.kind })),
        );
      } catch {
        // Non-fatal: the assignment controls just stay hidden.
      }
    })();
  }, []);

  useEffect(() => {
    void load();
  }, []);

  // The itemised breakdown is per-booking, so it's fetched when one is
  // opened rather than for every row in the list.
  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    getAppointmentDetail({ data: { id: openId } })
      .then((d) => !cancelled && setDetail(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [openId, rows]);

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
        subtitle="Click any booking to see everything, edit it, or move it. Cancelling frees its slot for new bookings straight away."
        actions={
          <Button onClick={() => setImporting(true)}>
            <Upload className="h-3.5 w-3.5" /> Import past jobs
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <TabBar
          layoutId="appt-filter"
          size="sm"
          value={filter}
          onChange={setFilter}
          tabs={(["all", "confirmed", "completed", "cancelled"] as Filter[]).map((f) => ({
            value: f,
            label: f[0].toUpperCase() + f.slice(1),
            count: counts[f],
          }))}
        />

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
                    <span className="tnum rounded-md bg-[var(--fill-2)] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
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
              {/* Editing is available whatever the status — correcting the
                  record of a finished or cancelled job is just as valid as
                  changing an upcoming one. */}
              <Button
                onClick={() =>
                  setEditing({
                    id: open.id,
                    serviceId: open.serviceId,
                    addOnIds: [...(open.addOnIds ?? [])],
                    location: open.location,
                    address: open.address ?? "",
                    make: open.vehicle?.make ?? "",
                    model: open.vehicle?.model ?? "",
                    year: open.vehicle?.year ?? "",
                    color: open.vehicle?.color ?? "",
                    notes: open.notes ?? "",
                    overrideOn: false,
                    price: open.totalPrice ?? 0,
                  })
                }
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
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
            <div className="mb-5 flex items-center justify-between rounded-xl bg-[var(--fill-2)] px-4 py-3 ring-1 ring-inset ring-[var(--line-1)]">
              <div>
                <p className="text-[11px] text-muted-foreground">Total</p>
                <p className="tnum text-2xl font-bold text-primary">
                  {money(detail?.breakdown.grandTotal ?? (open.totalPrice ?? 0) + (open.tip ?? 0))}
                </p>
                {!!open.tip && (
                  <p className="tnum text-[11px] text-emerald-300">incl. {money(open.tip)} tip</p>
                )}
              </div>
              <StatusPill status={open.status} />
            </div>

            {/* Camera first on a phone: during a job the before/after shots
                are the reason you opened this, and everything below is a long
                scroll away. Desktop keeps the full uploader further down. */}
            <QuickPhotoCapture
              bookingId={open.id}
              onUploaded={() => setPhotoRefresh((n) => n + 1)}
            />

            {/* Itemised money. Fetched per booking so it can price against
                the live catalog rather than guessing from the stored total. */}
            <DetailGroup title="Price breakdown">
              {!detail ? (
                <p className="py-3 text-[12.5px] text-muted-foreground">Working it out…</p>
              ) : (
                <div className="rounded-xl bg-[var(--fill-1)] p-3.5 ring-1 ring-inset ring-[var(--line-1)]">
                  {detail.breakdown.lines.map((l, i) => (
                    <motion.div
                      key={`${l.label}-${i}`}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0, transition: { delay: i * 0.04 } }}
                      className="flex items-baseline justify-between gap-3 border-b border-[var(--line-1)] py-2 last:border-0"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-medium text-foreground">
                          {l.label}
                        </span>
                        {l.detail && (
                          <span className="block text-[10.5px] text-muted-foreground">
                            {l.detail}
                          </span>
                        )}
                      </span>
                      <span
                        className={`tnum shrink-0 text-[12.5px] font-semibold ${
                          l.amount < 0 ? "text-emerald-300" : "text-foreground"
                        }`}
                      >
                        {l.amount < 0 ? "−" : ""}
                        {money(Math.abs(l.amount))}
                      </span>
                    </motion.div>
                  ))}

                  <div className="mt-2 flex items-baseline justify-between border-t border-[var(--line-2)] pt-2.5">
                    <span className="text-[12.5px] font-bold text-foreground">Total</span>
                    <span className="tnum text-[15px] font-bold text-primary">
                      {money(detail.breakdown.grandTotal)}
                    </span>
                  </div>
                  {detail.breakdown.balance > 0 && (
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="text-[11.5px] text-muted-foreground">Still owed</span>
                      <span className="tnum text-[12px] font-semibold text-amber-300">
                        {money(detail.breakdown.balance)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </DetailGroup>

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
                        className="rounded-md bg-[var(--fill-2)] px-2 py-1 text-[11px] font-medium"
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

            {(agents.length > 0 || locations.length > 0) && (
              <DetailGroup title="Assignment">
                {agents.length > 0 && (
                  <DetailField label="Detailer" icon={UserCog}>
                    <select
                      className={`${inputCls} mt-1`}
                      value={open.agentId ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        act(() =>
                          assignAppointment({
                            data: { bookingId: open.id, agentId: e.target.value || null },
                          }),
                        )
                      }
                    >
                      <option value="">Nobody assigned</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </DetailField>
                )}
                {locations.length > 0 && (
                  <DetailField label="Shop / zone" icon={MapPin}>
                    <select
                      className={`${inputCls} mt-1`}
                      value={open.locationId ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        act(() =>
                          assignAppointment({
                            data: { bookingId: open.id, locationId: e.target.value || null },
                          }),
                        )
                      }
                    >
                      <option value="">Not tagged</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.kind})
                        </option>
                      ))}
                    </select>
                  </DetailField>
                )}
              </DetailGroup>
            )}

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
              <PhotoUploader bookingId={open.id} refreshKey={photoRefresh} />
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

      {/* ---- Edit an existing booking ---- */}
      <EditorModal
        open={!!editing}
        onClose={() => setEditing(null)}
        width="lg"
        title="Edit appointment"
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                if (!editing) return;
                const draft = editing;
                setEditing(null);
                await act(() =>
                  updateAppointment({
                    data: {
                      id: draft.id,
                      serviceId: draft.serviceId,
                      addOnIds: draft.addOnIds,
                      location: draft.location,
                      address: draft.address.trim() || undefined,
                      vehicle: {
                        make: draft.make.trim(),
                        model: draft.model.trim(),
                        year: draft.year.trim(),
                        color: draft.color.trim(),
                      },
                      notes: draft.notes.trim() || undefined,
                      priceOverride: draft.overrideOn ? draft.price : undefined,
                    },
                  }),
                );
              }}
            >
              Save changes
            </Button>
          </>
        }
      >
        {editing && detail && (
          <>
            <p className="rounded-lg bg-[var(--fill-1)] px-3.5 py-2.5 text-[12px] text-muted-foreground ring-1 ring-inset ring-[var(--line-1)]">
              Changing the package or add-ons re-prices the job and resizes the block it takes in
              the calendar. To move it to a different day or time, use Reschedule instead.
            </p>

            <Field label="Package">
              <select
                className={inputCls}
                value={editing.serviceId}
                onChange={(e) => setEditing({ ...editing, serviceId: e.target.value })}
              >
                {detail.catalog.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} — ${s.priceValue}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Add-ons">
              <div className="flex flex-wrap gap-1.5">
                {detail.catalog.addOns.map((a) => {
                  const on = editing.addOnIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() =>
                        setEditing({
                          ...editing,
                          addOnIds: on
                            ? editing.addOnIds.filter((x) => x !== a.id)
                            : [...editing.addOnIds, a.id],
                        })
                      }
                      className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 ring-inset transition ${
                        on
                          ? "bg-primary/12 text-primary ring-primary/30"
                          : "bg-[var(--fill-2)] text-muted-foreground ring-[var(--line-2)] hover:text-foreground"
                      }`}
                    >
                      {a.name}
                      <span className="ml-1.5 opacity-60">${a.price}</span>
                    </button>
                  );
                })}
              </div>
            </Field>

            <FieldRow>
              <Field label="Where">
                <select
                  className={inputCls}
                  value={editing.location}
                  onChange={(e) =>
                    setEditing({ ...editing, location: e.target.value as "mobile" | "shop" })
                  }
                >
                  <option value="shop">At the shop</option>
                  <option value="mobile">Mobile (+${detail.catalog.travelFee})</option>
                </select>
              </Field>
              {editing.location === "mobile" && (
                <Field label="Address">
                  <input
                    className={inputCls}
                    value={editing.address}
                    maxLength={200}
                    onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                  />
                </Field>
              )}
            </FieldRow>

            <FieldRow>
              <Field label="Make">
                <input
                  className={inputCls}
                  value={editing.make}
                  maxLength={40}
                  onChange={(e) => setEditing({ ...editing, make: e.target.value })}
                />
              </Field>
              <Field label="Model">
                <input
                  className={inputCls}
                  value={editing.model}
                  maxLength={40}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Year">
                <input
                  className={inputCls}
                  value={editing.year}
                  maxLength={4}
                  onChange={(e) => setEditing({ ...editing, year: e.target.value })}
                />
              </Field>
              <Field label="Colour">
                <input
                  className={inputCls}
                  value={editing.color}
                  maxLength={30}
                  onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                />
              </Field>
            </FieldRow>

            <Field label="Notes">
              <textarea
                className={`${inputCls} min-h-[70px] resize-y`}
                value={editing.notes}
                maxLength={1000}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              />
            </Field>

            {/* Live re-price, so the effect of a change is visible before saving. */}
            {(() => {
              const svc = detail.catalog.services.find((s) => s.id === editing.serviceId);
              const picked = detail.catalog.addOns.filter((a) => editing.addOnIds.includes(a.id));
              const travel = editing.location === "mobile" ? detail.catalog.travelFee : 0;
              const computed =
                (svc?.priceValue ?? 0) + picked.reduce((s, a) => s + a.price, 0) + travel;
              const minutes =
                (svc?.durationMinutes ?? 0) + picked.reduce((s, a) => s + a.durationMinutes, 0);
              return (
                <div className="rounded-lg bg-[var(--fill-2)] px-3.5 py-3 ring-1 ring-inset ring-[var(--line-1)]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] text-muted-foreground">New price</span>
                    <span className="tnum text-[16px] font-bold text-foreground">
                      {money(editing.overrideOn ? editing.price : computed)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {hours(minutes)} of calendar time
                    {editing.overrideOn && ` · catalog price is ${money(computed)}`}
                  </p>

                  <label className="mt-3 flex cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={editing.overrideOn}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          overrideOn: e.target.checked,
                          price: e.target.checked ? computed : editing.price,
                        })
                      }
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                    <span className="text-[12px] text-foreground">
                      Charge a custom price for this job
                    </span>
                  </label>
                  {editing.overrideOn && (
                    <input
                      type="number"
                      min={0}
                      step="1"
                      className={`${inputCls} mt-2`}
                      value={editing.price}
                      onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
                    />
                  )}
                </div>
              );
            })()}
          </>
        )}
      </EditorModal>

      <AppointmentImport
        open={importing}
        onClose={() => setImporting(false)}
        onDone={load}
      />


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
    <Portal><AnimatePresence>
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
            className="max-h-[88vh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-[var(--line-2)] bg-[var(--card)] p-6"
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
                          : "bg-[var(--fill-1)] text-foreground ring-[var(--line-2)] hover:bg-[var(--fill-3)]"
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
    </AnimatePresence></Portal>
  );
}
