import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import {
  CalendarDays,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Users,
  X,
} from "lucide-react";

import {
  listAppointments,
  listCustomers,
  removeCustomer,
  saveCustomer,
} from "@/lib/api/admin.functions";
import { CsvImport } from "@/components/admin/CsvImport";
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
  inputCls,
  money,
  prettyDate,
  time12h,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/customers")({
  component: Customers,
});

type Row = Awaited<ReturnType<typeof listCustomers>>["clients"][number];
type Booking = Awaited<ReturnType<typeof listAppointments>>["bookings"][number];
type Draft = { id?: string; name: string; email: string; phone: string; notes: string };

const emptyDraft: Draft = { name: "", email: "", phone: "", notes: "" };

function Customers() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      // Pull bookings too so a customer's history is one click away rather
      // than another round-trip when the panel opens.
      const [c, a] = await Promise.all([listCustomers(), listAppointments()]);
      setRows(c.clients);
      setBookings(a.bookings);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load customers.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((c) =>
      [c.name, c.email, c.phone, c.notes].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const open = rows?.find((c) => c.id === openId) ?? null;
  const history = useMemo(
    () =>
      bookings
        .filter((b) => b.clientId === openId)
        .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`)),
    [bookings, openId],
  );

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await saveCustomer({
        data: {
          id: draft.id,
          name: draft.name.trim(),
          email: draft.email.trim(),
          phone: draft.phone.trim(),
          notes: draft.notes.trim() || undefined,
        },
      });
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: Row) => {
    if (!confirm(`Delete ${row.name}? Their booking history stays.`)) return;
    setError(null);
    try {
      await removeCustomer({ data: { id: row.id } });
      setOpenId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete.");
    }
  };

  if (!rows && !error) return <Spinner label="Loading customers…" />;

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Click anyone to see their full history, contact details and notes."
        actions={
          <>
            <CsvImport onDone={load} />
            <Button variant="primary" onClick={() => setDraft({ ...emptyDraft })}>
              <Plus className="h-3.5 w-3.5" /> Add customer
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Search name, email, phone, notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="tnum text-[12px] text-muted-foreground">
          {filtered.length} of {rows?.length ?? 0}
        </p>
      </div>

      <AnimatePresence>{error && <ErrorNote>{error}</ErrorNote>}</AnimatePresence>

      {filtered.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={Users}
            title={rows?.length ? "No matches" : "No customers yet"}
            body={
              rows?.length
                ? "Try a different search."
                : "Anyone who books through the site is added here automatically."
            }
            action={
              <Button variant="primary" onClick={() => setDraft({ ...emptyDraft })}>
                <Plus className="h-3.5 w-3.5" /> Add one manually
              </Button>
            }
          />
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {filtered.map((c, i) => (
              <ListRow key={c.id} index={i} onClick={() => setOpenId(c.id)}>
                <Avatar name={c.name} />

                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-foreground">{c.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1 truncate">
                      <Mail className="h-3 w-3 shrink-0" />
                      {c.email}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {c.phone}
                    </span>
                    {c.lastVisit && (
                      <span className="hidden items-center gap-1 sm:inline-flex">
                        <CalendarDays className="h-3 w-3" />
                        Last {prettyDate(c.lastVisit)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-4">
                  <div className="text-right">
                    <p className="tnum text-[15px] font-bold text-foreground">
                      {money(c.lifetimeValue)}
                    </p>
                    <p className="tnum text-[11px] text-muted-foreground">
                      {c.bookingCount} booking{c.bookingCount === 1 ? "" : "s"}
                    </p>
                  </div>
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
        eyebrow={open ? `Customer since ${new Date(open.createdAt).toLocaleDateString()}` : ""}
        title={open?.name ?? ""}
        footer={
          open && (
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={() =>
                  setDraft({
                    id: open.id,
                    name: open.name,
                    email: open.email,
                    phone: open.phone,
                    notes: open.notes ?? "",
                  })
                }
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button variant="ghost" onClick={() => remove(open)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          )
        }
      >
        {open && (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-[var(--fill-2)] px-4 py-3 ring-1 ring-inset ring-[var(--line-1)]">
                <p className="text-[11px] text-muted-foreground">Lifetime value</p>
                <p className="tnum mt-0.5 text-xl font-bold text-primary">
                  {money(open.lifetimeValue)}
                </p>
              </div>
              <div className="rounded-xl bg-[var(--fill-2)] px-4 py-3 ring-1 ring-inset ring-[var(--line-1)]">
                <p className="text-[11px] text-muted-foreground">Bookings</p>
                <p className="tnum mt-0.5 text-xl font-bold text-foreground">{open.bookingCount}</p>
              </div>
            </div>

            <DetailGroup title="Contact">
              <DetailField label="Email" icon={Mail}>
                <a href={`mailto:${open.email}`} className="text-primary hover:underline">
                  {open.email}
                </a>
              </DetailField>
              <DetailField label="Phone" icon={Phone}>
                <a href={`tel:${open.phone}`} className="text-primary hover:underline">
                  {open.phone}
                </a>
              </DetailField>
              <DetailField label="Notes" icon={StickyNote}>
                {open.notes || <span className="text-muted-foreground">None</span>}
              </DetailField>
            </DetailGroup>

            <DetailGroup title={`Booking history (${history.length})`}>
              {history.length === 0 ? (
                <p className="py-2 text-[13px] text-muted-foreground">
                  No bookings yet — added manually.
                </p>
              ) : (
                <div className="space-y-2 pt-1">
                  {history.map((b) => (
                    <div
                      key={b.id}
                      className="rounded-xl border border-[var(--line-1)] bg-[var(--fill-1)] px-3.5 py-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-foreground">
                          {b.serviceTitle}
                        </span>
                        <span className="tnum text-[13px] font-bold text-foreground">
                          {money(b.totalPrice ?? 0)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-[11.5px] text-muted-foreground">
                          {prettyDate(b.date)} · {time12h(b.startTime)}
                        </span>
                        <StatusPill status={b.status} />
                      </div>
                      {b.vehicle && (
                        <p className="mt-1 text-[11.5px] text-muted-foreground">
                          {b.vehicle.year} {b.vehicle.make} {b.vehicle.model} · {b.vehicle.color}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </DetailGroup>
          </>
        )}
      </DetailPanel>

      <Portal><AnimatePresence>
        {draft && (
          <div
            onClick={() => setDraft(null)}
            className="admin-theme fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="max-h-[88vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-[var(--line-2)] bg-[var(--card)] p-6"
            >
              <div className="flex items-start justify-between">
                <h2 className="text-lg font-bold tracking-tight text-foreground">
                  {draft.id ? "Edit customer" : "New customer"}
                </h2>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-5 space-y-4">
                <Field label="Name">
                  <input
                    className={inputCls}
                    value={draft.name}
                    maxLength={120}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
                <Field label="Email">
                  <input
                    className={inputCls}
                    type="email"
                    value={draft.email}
                    maxLength={255}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    className={inputCls}
                    value={draft.phone}
                    maxLength={30}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  />
                </Field>
                <Field label="Notes">
                  <textarea
                    className={`${inputCls} min-h-[80px] resize-y`}
                    value={draft.notes}
                    maxLength={1000}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    placeholder="Gate code, preferences, vehicle quirks…"
                  />
                </Field>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button onClick={() => setDraft(null)}>Cancel</Button>
                <Button variant="primary" loading={busy} onClick={save}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence></Portal>
    </>
  );
}
