import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Car,
  Check,
  Clock,
  Home,
  Loader2,
  MapPin,
  Truck,
} from "lucide-react";

import { StepProgress } from "./StepProgress";
import { DateTimeStep, formatTime12h } from "./DateTimeStep";
import {
  CustomerInfoStep,
  emptyCustomer,
  validateCustomer,
  type CustomerErrors,
  type CustomerInfo,
} from "./CustomerInfoStep";
import { ConfirmationModal, type ConfirmationDetails } from "./ConfirmationModal";
import { createBooking, getCatalog } from "@/lib/api/booking.functions";
import {
  quote,
  type AddOnDef,
  type AddOnId,
  type LocationChoice,
  type ServiceDef,
  type ServiceId,
} from "@/lib/services";

type Catalog = {
  services: ServiceDef[];
  addOns: AddOnDef[];
  travelFee: number;
};

const STEPS = ["Service", "Add-ons", "Location", "Date & time", "Your info", "Review"];

const pageVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 48 : -48, filter: "blur(8px)" }),
  center: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -48 : 48, filter: "blur(8px)" }),
};

const listItem = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.05 * i, type: "spring" as const, stiffness: 160, damping: 18 },
  }),
};

const longDate = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function SelectRing({ selected }: { selected: boolean }) {
  return (
    <motion.span
      animate={{ scale: selected ? 1 : 0.7, opacity: selected ? 1 : 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 18 }}
      className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground"
      style={{ boxShadow: "var(--shadow-glow)" }}
    >
      <Check className="h-4 w-4" />
    </motion.span>
  );
}

export function BookingWizard({
  onDone,
  initialServiceId,
}: {
  onDone?: () => void;
  /** Preselect a package and skip straight past the picker (Back still works). */
  initialServiceId?: ServiceId;
}) {
  const [step, setStep] = useState(initialServiceId ? 1 : 0);
  const [dir, setDir] = useState(1);
  const [service, setService] = useState<ServiceId | null>(initialServiceId ?? null);
  const [picked, setPicked] = useState<AddOnId[]>([]);
  const [location, setLocation] = useState<LocationChoice | null>(null);
  const [address, setAddress] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerInfo>(emptyCustomer);
  const [errors, setErrors] = useState<CustomerErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmationDetails | null>(null);

  // The catalog is editable from /admin/services, so it's fetched rather
  // than imported — prices and packages can change without a redeploy.
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCatalog()
      .then((res) => {
        if (!cancelled) setCatalog(res);
      })
      .catch(() => {
        if (!cancelled) setCatalogError("Couldn't load our packages. Please refresh.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const services = catalog?.services ?? [];
  const addOnList = catalog?.addOns ?? [];
  const travelFee = catalog?.travelFee ?? 0;

  const chosenService = services.find((s) => s.id === service) ?? null;
  const chosenAddOns = addOnList.filter((a) => picked.includes(a.id));

  const { price: total, durationMinutes: minutes } = useMemo(
    () =>
      quote({
        service: chosenService ?? undefined,
        addOns: chosenAddOns,
        location,
        travelFee,
      }),
    [chosenService, chosenAddOns, location, travelFee],
  );

  const dateLabel = date ? longDate.format(new Date(`${date}T12:00:00`)) : "—";
  const timeLabel = time ? formatTime12h(time) : "—";
  const locationLabel =
    location === "mobile"
      ? `Mobile · ${address || "address pending"} (+$${travelFee})`
      : location === "shop"
        ? "At the shop"
        : "—";

  // Changing the package or add-ons changes how long the job takes, which can
  // invalidate an already-picked slot — so clear the date/time selection.
  const pickService = (id: ServiceId) => {
    setService(id);
    setDate(null);
    setTime(null);
  };

  const toggleAddOn = (id: AddOnId) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    setDate(null);
    setTime(null);
  };

  const stepError = (): string | null => {
    if (step === 0 && !service) return "Choose a service package.";
    if (step === 2) {
      if (!location) return "Pick mobile or in-shop service.";
      if (location === "mobile" && address.trim().length < 5) return "Enter your service address.";
    }
    if (step === 3 && (!date || !time)) return "Select a date and a time slot.";
    if (step === 4) {
      const e = validateCustomer(customer);
      if (Object.keys(e).length) {
        setErrors(e);
        return "Please fix the highlighted fields.";
      }
      setErrors({});
    }
    return null;
  };

  const go = (next: number) => {
    setNotice(null);
    setDir(next > step ? 1 : -1);
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  };

  const submit = async () => {
    if (!service || !date || !time || !location) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await createBooking({
        data: {
          name: customer.name.trim(),
          email: customer.email.trim(),
          phone: customer.phone.trim(),
          date,
          startTime: time,
          serviceId: service,
          addOnIds: picked,
          location,
          address: location === "mobile" ? address.trim() : undefined,
          vehicle: {
            make: customer.make.trim(),
            model: customer.model.trim(),
            year: customer.year,
            color: customer.color,
          },
          notes: customer.notes.trim() || undefined,
        },
      });

      setConfirmed({
        // Reference and total come back from the server, which recomputes
        // both — never the client's copy.
        reference: res.booking.reference,
        service: `${res.booking.serviceTitle} · $${chosenService?.priceValue ?? 0}`,
        addOns: res.booking.addOnTitles.length ? res.booking.addOnTitles.join(", ") : "None",
        location: locationLabel,
        dateLabel,
        time: timeLabel,
        customer: customer.name,
        phone: customer.phone,
        email: customer.email,
        vehicle: `${customer.year} ${customer.make} ${customer.model} · ${customer.color}`,
        notes: customer.notes.trim(),
        total: res.booking.totalPrice,
      });
    } catch (err) {
      // Most likely cause: the slot was taken between loading it and
      // submitting. Send them back to the date step to pick again.
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setNotice(message);
      if (/just booked|another slot/i.test(message)) {
        setTime(null);
        go(3);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const advance = () => {
    const err = stepError();
    if (err) {
      setNotice(err);
      return;
    }
    if (step === STEPS.length - 1) {
      void submit();
      return;
    }
    go(step + 1);
  };

  const closeConfirmation = () => {
    setConfirmed(null);
    onDone?.();
  };

  return (
    <div className="glass-strong sheen relative w-full rounded-4xl p-5 sm:p-8">
      <StepProgress steps={STEPS} current={step} />

      <div className="relative mt-8 min-h-[420px]">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === 0 && catalogError && (
              <p className="rounded-2xl bg-destructive/15 px-4 py-3 text-sm font-semibold text-destructive">
                {catalogError}
              </p>
            )}

            {step === 0 && !catalog && !catalogError && (
              <div className="grid gap-4" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="glass h-28 animate-pulse rounded-3xl" />
                ))}
              </div>
            )}

            {step === 0 && catalog && (
              <div className="grid gap-4">
                {services.map((s, i) => {
                  const selected = service === s.id;
                  return (
                    <motion.button
                      key={s.id}
                      type="button"
                      custom={i}
                      variants={listItem}
                      initial="hidden"
                      animate="show"
                      whileHover={{ x: 6 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => pickService(s.id)}
                      className={`glass relative rounded-3xl p-5 text-left ${
                        selected ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-primary/40"
                      }`}
                    >
                      <SelectRing selected={selected} />
                      <div className="flex flex-wrap items-baseline gap-3 pr-10">
                        <p className="font-semibold text-foreground">{s.title}</p>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          {Math.round((s.durationMinutes / 60) * 10) / 10} hr
                        </span>
                        <span className="ml-auto text-lg font-bold text-primary">
                          ${s.priceValue}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm uppercase tracking-wider text-muted-foreground">
                        {s.subtitle}
                      </p>
                    </motion.button>
                  );
                })}
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {addOnList.map((a, i) => {
                  const selected = picked.includes(a.id);
                  return (
                    <motion.button
                      key={a.id}
                      type="button"
                      custom={i}
                      variants={listItem}
                      initial="hidden"
                      animate="show"
                      whileHover={{ y: -4 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => toggleAddOn(a.id)}
                      className={`glass relative rounded-3xl p-4 text-left ${
                        selected ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-primary/40"
                      }`}
                    >
                      <SelectRing selected={selected} />
                      <p className="pr-10 font-semibold text-foreground">{a.name}</p>
                      <p className="text-xs text-muted-foreground">{a.detail}</p>
                      <p className="mt-2 text-sm font-bold text-primary">+${a.price}</p>
                    </motion.button>
                  );
                })}
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      {
                        id: "mobile" as const,
                        icon: Truck,
                        title: "Mobile — I come to you",
                        text: `Fully self-contained setup with water and power. +$${travelFee} travel.`,
                      },
                      {
                        id: "shop" as const,
                        icon: Home,
                        title: "At the shop",
                        text: "Drop it off and I'll handle the rest.",
                      },
                    ] as const
                  ).map((opt, i) => {
                    const selected = location === opt.id;
                    const Icon = opt.icon;
                    return (
                      <motion.button
                        key={opt.id}
                        type="button"
                        custom={i}
                        variants={listItem}
                        initial="hidden"
                        animate="show"
                        whileHover={{ y: -6 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setLocation(opt.id)}
                        className={`glass relative rounded-3xl p-6 text-left ${
                          selected ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-primary/40"
                        }`}
                      >
                        <SelectRing selected={selected} />
                        <motion.span
                          animate={selected ? { rotate: [0, -8, 8, 0] } : { rotate: 0 }}
                          transition={{ duration: 0.5 }}
                          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10"
                        >
                          <Icon className="h-6 w-6 text-primary" />
                        </motion.span>
                        <p className="mt-4 pr-10 font-semibold text-foreground">{opt.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{opt.text}</p>
                      </motion.button>
                    );
                  })}
                </div>

                <AnimatePresence>
                  {location === "mobile" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <label className="glass block rounded-3xl p-4">
                        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                          <MapPin className="h-3.5 w-3.5" /> Service address
                        </span>
                        <input
                          value={address}
                          maxLength={200}
                          autoComplete="street-address"
                          onChange={(e) => setAddress(e.target.value)}
                          placeholder="123 Queen St E, Sault Ste. Marie"
                          className="mt-2 w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-4 focus:ring-primary/15"
                        />
                      </label>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {step === 3 && service && (
              <DateTimeStep
                serviceId={service}
                addOnIds={picked}
                date={date}
                time={time}
                onDate={(iso) => {
                  setDate(iso);
                  setTime(null);
                }}
                onTime={setTime}
              />
            )}

            {step === 4 && (
              <CustomerInfoStep
                value={customer}
                errors={errors}
                onChange={(patch) => setCustomer((c) => ({ ...c, ...patch }))}
              />
            )}

            {step === 5 && (
              <div className="grid gap-4">
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="glass rounded-3xl p-6"
                >
                  <div className="flex items-center gap-3">
                    <Car className="h-5 w-5 text-primary" />
                    <p className="font-semibold text-foreground">Booking summary</p>
                  </div>
                  <dl className="mt-4 space-y-3 text-sm">
                    <Row
                      label="Service"
                      value={
                        chosenService ? `${chosenService.title} · $${chosenService.priceValue}` : "—"
                      }
                    />
                    <Row
                      label="Add-ons"
                      value={
                        chosenAddOns.length
                          ? chosenAddOns.map((a) => `${a.name} (+$${a.price})`).join(", ")
                          : "None"
                      }
                    />
                    <Row label="Location" value={locationLabel} />
                    <Row label="Date & time" value={`${dateLabel} · ${timeLabel}`} />
                    <Row
                      label="Estimated time"
                      value={`${Math.round((minutes / 60) * 10) / 10} hours`}
                    />
                  </dl>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1, transition: { delay: 0.06 } }}
                  className="glass rounded-3xl p-6"
                >
                  <div className="flex items-center gap-3">
                    <CalendarDays className="h-5 w-5 text-primary" />
                    <p className="font-semibold text-foreground">Customer & vehicle</p>
                  </div>
                  <dl className="mt-4 space-y-3 text-sm">
                    <Row label="Name" value={customer.name || "—"} />
                    <Row label="Phone" value={customer.phone || "—"} />
                    <Row label="Email" value={customer.email || "—"} />
                    <Row
                      label="Vehicle"
                      value={
                        customer.make
                          ? `${customer.year} ${customer.make} ${customer.model} · ${customer.color}`
                          : "—"
                      }
                    />
                    <Row label="Notes" value={customer.notes.trim() || "None"} />
                  </dl>
                  <div className="mt-5 flex items-baseline justify-between border-t border-border pt-4">
                    <span className="text-sm font-semibold text-muted-foreground">Total</span>
                    <motion.span
                      key={total}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-3xl font-bold text-primary"
                    >
                      ${total}
                    </motion.span>
                  </div>
                </motion.div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {notice && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-6 rounded-2xl bg-destructive/15 px-4 py-3 text-sm font-semibold text-destructive"
          >
            {notice}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-8 flex items-center justify-between gap-3">
        <motion.button
          type="button"
          whileHover={{ x: -3 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => go(step - 1)}
          disabled={step === 0 || submitting}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground transition disabled:pointer-events-none disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </motion.button>

        <div className="hidden items-baseline gap-2 sm:flex">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Running total
          </span>
          <motion.span
            key={total}
            initial={{ y: -6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-lg font-bold text-foreground"
          >
            ${total}
          </motion.span>
        </div>

        <motion.button
          type="button"
          whileHover={{ scale: submitting ? 1 : 1.03 }}
          whileTap={{ scale: submitting ? 1 : 0.96 }}
          onClick={advance}
          disabled={submitting}
          className="sheen inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-semibold text-primary-foreground transition disabled:opacity-70"
          style={{ backgroundImage: "var(--gradient-brand)", boxShadow: "var(--shadow-glow)" }}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Booking…
            </>
          ) : (
            <>
              {step === STEPS.length - 1 ? "Confirm booking" : "Continue"}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </motion.button>
      </div>

      <ConfirmationModal open={!!confirmed} details={confirmed} onClose={closeConfirmation} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}
