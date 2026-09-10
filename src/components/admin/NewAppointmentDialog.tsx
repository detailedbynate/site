import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";

import {
  createAppointment,
  getBookingFormOptions,
  getOpenSlots,
} from "@/lib/api/appointments.functions";
import { EditorModal, FieldRow } from "./EditorModal";
import { Button, ErrorNote, Field, hours, inputCls, money, time12h } from "./ui";

type Options = Awaited<ReturnType<typeof getBookingFormOptions>>;

type Draft = {
  /** "" = a new customer typed in below. */
  clientId: string;
  name: string;
  email: string;
  phone: string;
  serviceId: string;
  addOnIds: string[];
  location: "mobile" | "shop";
  address: string;
  date: string;
  startTime: string;
  /** Typed time rather than an open slot — skips the availability check. */
  customTime: boolean;
  make: string;
  model: string;
  year: string;
  color: string;
  notes: string;
  overrideOn: boolean;
  price: number;
  sendConfirmation: boolean;
};

function blankDraft(serviceId = ""): Draft {
  return {
    clientId: "",
    name: "",
    email: "",
    phone: "",
    serviceId,
    addOnIds: [],
    location: "shop",
    address: "",
    // The browser's own date, in the YYYY-MM-DD shape the input wants.
    date: new Date().toLocaleDateString("en-CA"),
    startTime: "",
    customTime: false,
    make: "",
    model: "",
    year: "",
    color: "",
    notes: "",
    overrideOn: false,
    price: 0,
    sendConfirmation: true,
  };
}

/** A labelled group that isn't a <label> — clicking the caption must not
    fire the first button inside it. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-[12px] font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/**
 * Book a job by hand — a phone call, a walk-in, a regular. Offers the same
 * open slots a customer would see, or a custom time that overrides them.
 */
export function NewAppointmentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (bookingId: string) => void;
}) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [slots, setSlots] = useState<{ startTime: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form and fresh options on every open — prices and the customer
  // list may have changed since last time.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setOpts(null);
    getBookingFormOptions()
      .then((o) => {
        setOpts(o);
        setDraft(blankDraft(o.services[0]?.id ?? ""));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the form."));
  }, [open]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const addOnKey = draft.addOnIds.join(",");

  // Open times depend on the day, the job's length and mobile vs shop hours.
  useEffect(() => {
    if (!open || !draft.serviceId || !draft.date) return;
    let cancelled = false;
    setSlots(null);
    getOpenSlots({
      data: {
        date: draft.date,
        serviceId: draft.serviceId,
        addOnIds: draft.addOnIds,
        location: draft.location,
      },
    })
      .then((r) => {
        if (cancelled) return;
        setSlots(r.slots);
        // A picked slot that no longer fits (longer job, other day) is dropped
        // rather than silently submitted.
        setDraft((d) =>
          d.customTime || r.slots.some((s) => s.startTime === d.startTime)
            ? d
            : { ...d, startTime: "" },
        );
      })
      .catch(() => !cancelled && setSlots([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft.date, draft.serviceId, addOnKey, draft.location]);

  const svc = opts?.services.find((s) => s.id === draft.serviceId);
  const picked = opts?.addOns.filter((a) => draft.addOnIds.includes(a.id)) ?? [];
  const travel = draft.location === "mobile" ? (opts?.travelFee ?? 0) : 0;
  const computed = (svc?.priceValue ?? 0) + picked.reduce((s, a) => s + a.price, 0) + travel;
  const minutes =
    (svc?.durationMinutes ?? 0) + picked.reduce((s, a) => s + a.durationMinutes, 0);
  const existing = opts?.clients.find((c) => c.id === draft.clientId);
  const hasEmail = draft.clientId ? !!existing?.email : !!draft.email.trim();

  const submit = async () => {
    setError(null);
    if (!draft.clientId && !draft.name.trim()) {
      setError("Enter the customer's name, or pick an existing customer.");
      return;
    }
    if (!draft.serviceId) {
      setError("Pick a package.");
      return;
    }
    if (!draft.startTime) {
      setError("Pick a time.");
      return;
    }
    if (draft.location === "mobile" && draft.address.trim().length < 5) {
      setError("Add the address for a mobile job.");
      return;
    }
    setBusy(true);
    try {
      const res = await createAppointment({
        data: {
          clientId: draft.clientId || undefined,
          name: draft.name.trim(),
          email: draft.email.trim(),
          phone: draft.phone.trim(),
          date: draft.date,
          startTime: draft.startTime,
          serviceId: draft.serviceId,
          addOnIds: draft.addOnIds,
          location: draft.location,
          address: draft.location === "mobile" ? draft.address.trim() : undefined,
          vehicle: {
            make: draft.make.trim(),
            model: draft.model.trim(),
            year: draft.year.trim(),
            color: draft.color.trim(),
          },
          notes: draft.notes.trim() || undefined,
          priceOverride: draft.overrideOn ? draft.price : undefined,
          force: draft.customTime,
          sendConfirmation: draft.sendConfirmation && hasEmail,
        },
      });
      onCreated(res.booking.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the appointment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorModal
      open={open}
      onClose={onClose}
      width="lg"
      title="New appointment"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!opts} onClick={submit}>
            Create appointment
          </Button>
        </>
      }
    >
      {!opts ? (
        error ? (
          <ErrorNote>{error}</ErrorNote>
        ) : (
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        )
      ) : (
        <>
          <Field label="Customer">
            <select
              className={inputCls}
              value={draft.clientId}
              onChange={(e) => set({ clientId: e.target.value })}
            >
              <option value="">+ New customer</option>
              {opts.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` · ${c.phone}` : c.email ? ` · ${c.email}` : ""}
                </option>
              ))}
            </select>
          </Field>

          {!draft.clientId && (
            <>
              <FieldRow>
                <Field label="Name">
                  <input
                    className={inputCls}
                    value={draft.name}
                    maxLength={120}
                    onChange={(e) => set({ name: e.target.value })}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    className={inputCls}
                    type="tel"
                    value={draft.phone}
                    maxLength={30}
                    onChange={(e) => set({ phone: e.target.value })}
                  />
                </Field>
              </FieldRow>
              <Field label="Email" hint="Optional. Without one, no confirmation email is sent.">
                <input
                  className={inputCls}
                  type="email"
                  value={draft.email}
                  maxLength={255}
                  onChange={(e) => set({ email: e.target.value })}
                />
              </Field>
            </>
          )}

          <Field label="Package">
            <select
              className={inputCls}
              value={draft.serviceId}
              onChange={(e) => set({ serviceId: e.target.value })}
            >
              {opts.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} — ${s.priceValue}
                </option>
              ))}
            </select>
          </Field>

          {opts.addOns.length > 0 && (
            <Group label="Add-ons">
              <div className="flex flex-wrap gap-1.5">
                {opts.addOns.map((a) => {
                  const on = draft.addOnIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() =>
                        set({
                          addOnIds: on
                            ? draft.addOnIds.filter((x) => x !== a.id)
                            : [...draft.addOnIds, a.id],
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
            </Group>
          )}

          <FieldRow>
            <Field label="Where">
              <select
                className={inputCls}
                value={draft.location}
                onChange={(e) => set({ location: e.target.value as "mobile" | "shop" })}
              >
                <option value="shop">At the shop</option>
                <option value="mobile">Mobile (+${opts.travelFee})</option>
              </select>
            </Field>
            {draft.location === "mobile" && (
              <Field label="Address">
                <input
                  className={inputCls}
                  value={draft.address}
                  maxLength={200}
                  onChange={(e) => set({ address: e.target.value })}
                />
              </Field>
            )}
          </FieldRow>

          <Field label="Date">
            <input
              type="date"
              className={inputCls}
              value={draft.date}
              onChange={(e) => set({ date: e.target.value })}
            />
          </Field>

          <Group label="Time">
            {draft.customTime ? (
              <>
                <input
                  type="time"
                  step={300}
                  aria-label="Custom start time"
                  className={inputCls}
                  value={draft.startTime}
                  onChange={(e) => set({ startTime: e.target.value })}
                />
                <p className="mt-1.5 text-[11.5px] text-amber-300">
                  A custom time skips the availability check, so it can fall outside your hours or
                  overlap another job.
                </p>
                <button
                  type="button"
                  className="mt-1.5 text-[12px] font-semibold text-primary hover:underline"
                  onClick={() => set({ customTime: false, startTime: "" })}
                >
                  Back to open times
                </button>
              </>
            ) : (
              <>
                {!slots ? (
                  <p className="text-[13px] text-muted-foreground">Checking…</p>
                ) : slots.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    Nothing open that day for a {hours(minutes)} job.
                  </p>
                ) : (
                  <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                    {slots.map((s) => (
                      <button
                        key={s.startTime}
                        type="button"
                        onClick={() => set({ startTime: s.startTime })}
                        className={`rounded-lg px-2 py-2 text-[12px] font-semibold ring-1 ring-inset transition ${
                          draft.startTime === s.startTime
                            ? "text-primary-foreground ring-transparent"
                            : "bg-[var(--fill-1)] text-foreground ring-[var(--line-2)] hover:bg-[var(--fill-3)]"
                        }`}
                        style={
                          draft.startTime === s.startTime
                            ? { backgroundImage: "var(--gradient-brand)" }
                            : undefined
                        }
                      >
                        {time12h(s.startTime)}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="mt-2 text-[12px] font-semibold text-primary hover:underline"
                  onClick={() => set({ customTime: true, startTime: draft.startTime || "09:00" })}
                >
                  Use a custom time instead
                </button>
              </>
            )}
          </Group>

          <FieldRow>
            <Field label="Make">
              <input
                className={inputCls}
                value={draft.make}
                maxLength={40}
                onChange={(e) => set({ make: e.target.value })}
              />
            </Field>
            <Field label="Model">
              <input
                className={inputCls}
                value={draft.model}
                maxLength={40}
                onChange={(e) => set({ model: e.target.value })}
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Year">
              <input
                className={inputCls}
                inputMode="numeric"
                value={draft.year}
                maxLength={4}
                onChange={(e) => set({ year: e.target.value })}
              />
            </Field>
            <Field label="Colour">
              <input
                className={inputCls}
                value={draft.color}
                maxLength={30}
                onChange={(e) => set({ color: e.target.value })}
              />
            </Field>
          </FieldRow>

          <Field label="Notes">
            <textarea
              className={`${inputCls} min-h-[70px] resize-y`}
              value={draft.notes}
              maxLength={1000}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </Field>

          <div className="rounded-lg bg-[var(--fill-2)] px-3.5 py-3 ring-1 ring-inset ring-[var(--line-1)]">
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] text-muted-foreground">Price</span>
              <span className="tnum text-[16px] font-bold text-foreground">
                {money(draft.overrideOn ? draft.price : computed)}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {hours(minutes)} of calendar time
              {draft.overrideOn && ` · catalog price is ${money(computed)}`}
            </p>

            <label className="mt-3 flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={draft.overrideOn}
                onChange={(e) =>
                  set({
                    overrideOn: e.target.checked,
                    price: e.target.checked ? computed : draft.price,
                  })
                }
                className="h-4 w-4 accent-[var(--primary)]"
              />
              <span className="text-[12px] text-foreground">Charge a custom price for this job</span>
            </label>
            {draft.overrideOn && (
              <input
                type="number"
                min={0}
                step="1"
                aria-label="Custom price"
                className={`${inputCls} mt-2`}
                value={draft.price}
                onChange={(e) => set({ price: Number(e.target.value) })}
              />
            )}
          </div>

          <label
            className={`flex items-center gap-2.5 ${hasEmail ? "cursor-pointer" : "opacity-55"}`}
          >
            <input
              type="checkbox"
              checked={draft.sendConfirmation && hasEmail}
              disabled={!hasEmail}
              onChange={(e) => set({ sendConfirmation: e.target.checked })}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            <span className="text-[12px] text-foreground">
              Email the customer a confirmation{!hasEmail && " (no email on file)"}
            </span>
          </label>

          <AnimatePresence>{error && <ErrorNote>{error}</ErrorNote>}</AnimatePresence>
        </>
      )}
    </EditorModal>
  );
}
