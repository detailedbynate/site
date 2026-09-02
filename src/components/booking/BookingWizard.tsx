import { useEffect, useMemo, useRef, useState } from "react";
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
  Tag,
  Truck,
  X,
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
import { checkCoupon, createBooking, getCatalog } from "@/lib/api/booking.functions";
import {
  quote,
  type AddOnDef,
  type AddOnId,
  type LocationChoice,
  type ServiceDef,
  type ServiceId,
} from "@/lib/services";

type FormFieldDef = {
  id: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox" | "number" | "date";
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options: string[];
  onlyForServices: string[];
};

type CatalogService = ServiceDef & { features: string[]; description: string };

type Catalog = {
  services: CatalogService[];
  addOns: AddOnDef[];
  travelFee: number;
  formFields: FormFieldDef[];
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

/**
 * The nearest ancestor that actually scrolls, or null when the page itself
 * is the scroller.
 *
 * Checked against scrollHeight as well as the computed overflow: a container
 * declared `overflow-y: auto` that isn't overflowing scrolls nothing, and
 * scrolling it instead of the page would silently do nothing.
 */
function scrollParentOf(node: HTMLElement): HTMLElement | null {
  let el = node.parentElement;
  while (el && el !== document.body && el !== document.documentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight + 1
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
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
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});

  // Discount code. `applied` only ever holds a code the SERVER accepted —
  // the client never decides what a code is worth.
  const [codeInput, setCodeInput] = useState("");
  const [applied, setApplied] = useState<{
    code: string;
    discount: number;
    newTotal: number;
    label: string;
  } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
  // Fields can be scoped to particular packages, so this depends on the pick.
  const activeFields = (catalog?.formFields ?? []).filter(
    (f) => f.onlyForServices.length === 0 || (service && f.onlyForServices.includes(service)),
  );
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

  // What the customer actually pays. Still only a preview — createBooking
  // recomputes the price and re-checks the code before anything is saved.
  const payable = applied ? Math.max(0, total - applied.discount) : total;

  const applyCode = async () => {
    if (!service || !codeInput.trim()) return;
    setCodeBusy(true);
    setCodeError(null);
    try {
      const res = await checkCoupon({
        data: {
          code: codeInput.trim(),
          serviceId: service,
          addOnIds: picked,
          location,
          email: customer.email.trim() || undefined,
        },
      });
      if (res.ok) {
        setApplied({
          code: res.code,
          discount: res.discount,
          newTotal: res.newTotal,
          label: res.label,
        });
        setCodeInput("");
      } else {
        setApplied(null);
        setCodeError(res.reason);
      }
    } catch {
      setCodeError("Couldn't check that code. Try again.");
    } finally {
      setCodeBusy(false);
    }
  };

  // A code priced against one selection shouldn't survive a change to that
  // selection — drop it and make them re-apply rather than show a stale total.
  useEffect(() => {
    setApplied(null);
    setCodeError(null);
  }, [service, picked, location]);

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
      const ce: Record<string, string> = {};
      for (const f of activeFields) {
        const v = (custom[f.id] ?? "").trim();
        if (f.required && !v) ce[f.id] = `${f.label} is required`;
      }
      setCustomErrors(ce);
      if (Object.keys(e).length || Object.keys(ce).length) {
        setErrors(e);
        return "Please fix the highlighted fields.";
      }
      setErrors({});
    }
    return null;
  };

  /*
    Bring the top of the wizard back into view when the step changes.

    Steps differ a lot in height — Add-ons is a long list, Location is two
    cards — so advancing from a tall step to a short one (or the reverse) left
    the page scrolled into the middle of the new step, or below it entirely.
    On a phone that reads as the panel "jumping", with the heading and the
    progress bar somewhere off-screen above.

    Phones only: on a desktop the whole wizard is usually visible at once and
    stealing the scroll position would be more disruptive than helpful.
  */
  const scrollToTopOnMobile = () => {
    const node = rootRef.current;
    if (!node || typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 768px)").matches) return;

    /*
      Scroll whatever actually scrolls.

      Opened from a "Book Now" button the wizard lives inside the modal, which
      is `fixed inset-0 overflow-y-auto` with the body locked — so the page
      does not scroll at all and window.scrollTo() is a no-op. That is the
      common case, which is why this appeared not to work: the panel stayed
      where it was, and the customer filled in a step without realising more
      fields were sitting off-screen above.
    */
    // Someone who has asked for less motion gets the jump, not the glide.
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth";

    const scroller = scrollParentOf(node);

    if (scroller) {
      const top =
        node.getBoundingClientRect().top - scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      if (top < scroller.scrollTop) {
        scroller.scrollTo({ top: Math.max(0, top - 12), behavior });
      }
      return;
    }

    const header = 64; // sticky site nav
    const top = node.getBoundingClientRect().top + window.scrollY - header;
    // Never scroll downward to reach it; only pull the view back up.
    if (top < window.scrollY) {
      window.scrollTo({ top: Math.max(0, top), behavior });
    }
  };

  // Runs after the new step is in the DOM, so the panel's height is the new
  // one. Deliberately an effect rather than a requestAnimationFrame callback:
  // rAF doesn't fire while a tab isn't painting, which would silently skip the
  // scroll. Skipped on mount so opening the wizard never moves the page.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    scrollToTopOnMobile();
    // scrollToTopOnMobile only reads refs and window, so step is the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const go = (next: number) => {
    setNotice(null);
    setDir(next > step ? 1 : -1);
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
    // The scroll itself happens in the effect below, once React has committed
    // the new step and the panel has its new height.
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
          customFields: Object.fromEntries(
            activeFields
              .map((f) => [f.label, (custom[f.id] ?? "").trim()])
              .filter(([, v]) => v),
          ),
          couponCode: applied?.code,
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
        // What they'll actually pay: the server's recomputed price less the
        // discount the server itself decided to honour.
        total: res.booking.totalPrice - (res.booking.discount ?? 0),
        discountCode: res.appliedCoupon,
        depositAmount: res.depositAmount || undefined,
        depositUrl: res.depositUrl,
        manageUrl: res.manageToken ? `/manage/${res.manageToken}` : undefined,
        discountAmount: res.discount || undefined,
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
    <div ref={rootRef} className="glass-strong sheen relative w-full rounded-4xl p-4 sm:p-8">
      <StepProgress steps={STEPS} current={step} />

      {/*
        A shorter floor on phones. The 420px minimum was sized for desktop; on
        a small screen it padded short steps with empty space, which pushed the
        Next button below the fold and made the panel look like it had grown.
      */}
      <div className="relative mt-5 min-h-[240px] sm:mt-8 sm:min-h-[420px]">
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
              <div className="grid gap-3 sm:gap-4" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="glass h-28 animate-pulse rounded-3xl" />
                ))}
              </div>
            )}

            {step === 0 && catalog && (
              <div className="grid gap-3 sm:gap-4">
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
                      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                        {s.description || s.subtitle}
                      </p>
                      {s.features.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {s.features.map((f) => (
                            <span
                              key={f}
                              className="rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-secondary-foreground"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      )}
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
              <div className="grid gap-3 sm:gap-4">
                <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
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
                        onClick={() => {
                          setLocation(opt.id);
                          setDate(null);
                          setTime(null);
                        }}
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
                location={location}
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
              <div className="grid gap-5">
                <CustomerInfoStep
                  value={customer}
                  errors={errors}
                  onChange={(patch) => setCustomer((c) => ({ ...c, ...patch }))}
                />

                {activeFields.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: 0.12 } }}
                    className="glass rounded-3xl p-5"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                      A few more details
                    </p>
                    <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 sm:grid-cols-2">
                      {activeFields.map((f) => (
                        <CustomFieldInput
                          key={f.id}
                          field={f}
                          value={custom[f.id] ?? ""}
                          error={customErrors[f.id]}
                          onChange={(v) => setCustom((c) => ({ ...c, [f.id]: v }))}
                        />
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {step === 5 && (
              <div className="grid gap-3 sm:gap-4">
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="glass rounded-3xl p-4 sm:p-6"
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
                  className="glass rounded-3xl p-4 sm:p-6"
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
                  {/* Discount code */}
                  <div className="mt-5 border-t border-border pt-4">
                    <AnimatePresence mode="wait" initial={false}>
                      {applied ? (
                        <motion.div
                          key="applied"
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 6 }}
                          className="flex flex-wrap items-center gap-2 rounded-2xl bg-primary/10 px-3.5 py-3 ring-1 ring-inset ring-primary/25"
                        >
                          <Tag className="h-4 w-4 shrink-0 text-primary" />
                          <span className="text-sm font-bold tracking-wide text-primary">
                            {applied.code}
                          </span>
                          <span className="text-xs text-muted-foreground">{applied.label}</span>
                          <span className="ml-auto text-sm font-bold text-primary">
                            −${applied.discount}
                          </span>
                          <button
                            type="button"
                            onClick={() => setApplied(null)}
                            aria-label="Remove discount code"
                            className="rounded-lg p-1 text-muted-foreground transition hover:bg-background/40 hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="entry"
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 6 }}
                        >
                          <div className="flex gap-2">
                            <input
                              value={codeInput}
                              maxLength={40}
                              placeholder="Discount code"
                              aria-label="Discount code"
                              onChange={(e) => {
                                setCodeInput(e.target.value.toUpperCase());
                                setCodeError(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void applyCode();
                                }
                              }}
                              className="min-w-0 flex-1 rounded-2xl border border-border bg-background/40 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-foreground outline-none transition placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                            />
                            <button
                              type="button"
                              onClick={() => void applyCode()}
                              disabled={!codeInput.trim() || codeBusy}
                              className="btn-liquid shrink-0 rounded-2xl px-5 py-3 text-sm font-bold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-40"
                              style={{ backgroundImage: "var(--gradient-brand)" }}
                            >
                              {codeBusy ? "Checking…" : "Apply"}
                            </button>
                          </div>
                          <AnimatePresence>
                            {codeError && (
                              <motion.p
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="mt-2 text-xs font-semibold text-destructive"
                              >
                                {codeError}
                              </motion.p>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="mt-5 flex items-baseline justify-between border-t border-border pt-4">
                    <span className="text-sm font-semibold text-muted-foreground">Total</span>
                    <div className="text-right">
                      {applied && (
                        <span className="mr-2 text-base font-semibold text-muted-foreground line-through">
                          ${total}
                        </span>
                      )}
                      <motion.span
                        key={payable}
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-3xl font-bold text-primary"
                      >
                        ${payable}
                      </motion.span>
                    </div>
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

      <div className="mt-6 flex items-center justify-between gap-3 sm:mt-8">
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

const fieldCls =
  "mt-1.5 w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-4 focus:ring-primary/15";

function CustomFieldInput({
  field,
  value,
  error,
  onChange,
}: {
  field: FormFieldDef;
  value: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  const label = (
    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {field.label}
      {field.required && <span className="text-destructive"> *</span>}
    </span>
  );

  return (
    <label className={field.type === "textarea" ? "block sm:col-span-2" : "block"}>
      {label}
      {field.type === "textarea" ? (
        <textarea
          className={`${fieldCls} min-h-[88px] resize-y`}
          value={value}
          placeholder={field.placeholder}
          maxLength={500}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "select" ? (
        <select className={fieldCls} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === "checkbox" ? (
        <span className="mt-2 flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={value === "Yes"}
            onChange={(e) => onChange(e.target.checked ? "Yes" : "")}
            className="h-4 w-4 rounded border-border accent-[var(--primary)]"
          />
          <span className="text-sm text-foreground">{field.placeholder || "Yes"}</span>
        </span>
      ) : (
        <input
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          className={fieldCls}
          value={value}
          placeholder={field.placeholder}
          maxLength={200}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.helpText && !error && (
        <span className="mt-1 block text-[11px] text-muted-foreground">{field.helpText}</span>
      )}
      {error && (
        <span className="mt-1 block text-[11px] font-semibold text-destructive">{error}</span>
      )}
    </label>
  );
}

/*
  A summary line.

  On a phone the label sits ABOVE the value, both left-aligned. Side by side
  it was two columns fighting over 300px: a long add-on list or a full
  "Friday, September 11 · 1:00 PM" got squeezed into a narrow right-hand
  column, wrapped raggedly, and — because the panel clips horizontally rather
  than scrolling — anything that could not wrap was silently cut off at the
  right edge.

  `min-w-0` is what actually lets the value shrink inside the flex row on
  desktop; without it a flex item refuses to go below its content width, which
  is the other half of the same bug. `break-words` handles the unbreakable
  cases — long email addresses especially.
*/
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-6">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-foreground sm:text-right">{value}</dd>
    </div>
  );
}
