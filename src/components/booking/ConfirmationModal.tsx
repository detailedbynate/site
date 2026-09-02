import { useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Car, Check, Copy, CreditCard, MapPin, User, X } from "lucide-react";

export type ConfirmationDetails = {
  reference: string;
  service: string;
  addOns: string;
  location: string;
  dateLabel: string;
  time: string;
  customer: string;
  phone: string;
  email: string;
  vehicle: string;
  notes: string;
  total: number;
  /** Set only when the server actually honoured a discount code. */
  discountCode?: string;
  discountAmount?: number;
  /** Deposit taken at booking, and the Stripe link to pay it. */
  depositAmount?: number;
  depositUrl?: string;
  /** The customer's private link to change or cancel this booking. */
  manageUrl?: string;
};

export function ConfirmationModal({
  open,
  details,
  onClose,
}: {
  open: boolean;
  details: ConfirmationDetails | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (typeof document === "undefined") return null;

  const copy = async () => {
    if (!details) return;
    try {
      await navigator.clipboard?.writeText(details.reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure origin / permissions) — the reference is
      // on screen anyway, so silently leave the button in its idle state.
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && details && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{
            backgroundColor: "color-mix(in oklab, var(--brand-deep) 72%, transparent)",
            backdropFilter: "blur(14px)",
          }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Booking confirmed"
            initial={{ opacity: 0, y: 40, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 180, damping: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[88vh] w-full max-w-lg overflow-hidden overflow-y-auto rounded-4xl border border-border bg-card"
            style={{ boxShadow: "var(--shadow-glass)" }}
          >
            {/* solid brand header — no washed-out glass */}
            <div
              className="sheen relative px-7 pb-9 pt-8 text-primary-foreground"
              style={{ backgroundImage: "var(--gradient-brand)" }}
            >
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute right-5 top-5 rounded-full bg-black/15 p-2 text-primary-foreground transition hover:bg-black/25"
              >
                <X className="h-4 w-4" />
              </button>

              <motion.span
                initial={{ scale: 0, rotate: -90 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 14 }}
                className="flex h-14 w-14 items-center justify-center rounded-2xl bg-black/15"
              >
                <Check className="h-7 w-7" />
              </motion.span>

              <motion.h2
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: 0.18 } }}
                className="mt-4 font-display text-2xl font-bold tracking-tight"
              >
                Booking confirmed
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { delay: 0.24 } }}
                className="mt-1 text-sm text-primary-foreground/80"
              >
                You'll get a confirmation shortly. Save your reference below.
              </motion.p>
            </div>

            <div className="relative z-10 -mt-5 px-7">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: 0.28 } }}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-3"
                style={{ boxShadow: "var(--shadow-glass)" }}
              >
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Reference
                  </p>
                  <p className="font-display text-lg font-bold tracking-tight text-foreground">
                    {details.reference}
                  </p>
                </div>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  onClick={copy}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-primary/60 hover:text-primary"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </motion.button>
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.34 } }}
              className="mt-5 grid gap-2 px-7"
            >
              <Block icon={CalendarDays} title="When">
                {details.dateLabel} · {details.time}
              </Block>
              <Block icon={MapPin} title="Where">
                {details.location}
              </Block>
              <Block icon={User} title="Service">
                {details.service}
                <span className="block text-muted-foreground">Add-ons: {details.addOns}</span>
              </Block>
              <Block icon={Car} title="Vehicle & contact">
                {details.vehicle}
                <span className="block text-muted-foreground">
                  {details.customer} · {details.phone} · {details.email}
                </span>
                {details.notes && (
                  <span className="block text-muted-foreground">Notes: {details.notes}</span>
                )}
              </Block>
            </motion.div>

            {details.discountCode && details.discountAmount ? (
              <div className="mt-5 flex items-baseline justify-between px-7">
                <span className="text-sm font-semibold text-primary">
                  Code {details.discountCode} applied
                </span>
                <span className="text-sm font-bold text-primary">−${details.discountAmount}</span>
              </div>
            ) : null}

            <div className="mt-5 flex items-baseline justify-between border-t border-border px-7 pt-4">
              <span className="text-sm font-semibold text-muted-foreground">Total due</span>
              <span className="font-display text-3xl font-bold text-foreground">
                ${details.total}
              </span>
            </div>

            {/* Deposit, when one is being taken. Placed under the total so
                it reads as part of the money, not as an afterthought. */}
            {details.depositAmount && details.depositUrl ? (
              <div className="mx-7 mt-4 rounded-2xl border border-primary/40 bg-primary/[0.06] px-4 py-3.5">
                <p className="text-[13px] font-semibold text-foreground">
                  ${details.depositAmount} deposit to confirm
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  The remaining ${details.total - details.depositAmount} is due on the day. We've
                  emailed this link too.
                </p>
                <a
                  href={details.depositUrl}
                  className="mt-3 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold text-primary-foreground"
                  style={{ backgroundImage: "var(--gradient-brand)" }}
                >
                  <CreditCard className="h-4 w-4" /> Pay the deposit
                </a>
              </div>
            ) : null}

            {details.manageUrl && (
              <p className="mt-4 px-7 text-[12.5px] leading-relaxed text-muted-foreground">
                Need to change or cancel?{" "}
                <a
                  href={details.manageUrl}
                  className="font-semibold text-primary underline-offset-2 hover:underline"
                >
                  Manage your booking
                </a>{" "}
                — the link is in your email too.
              </p>
            )}

            <div className="px-7 pb-7 pt-5">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={onClose}
                className="sheen w-full rounded-full px-6 py-3.5 text-sm font-semibold text-primary-foreground"
                style={{ backgroundImage: "var(--gradient-brand)", boxShadow: "var(--shadow-glow)" }}
              >
                Done
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Block({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/50 px-4 py-3">
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" /> {title}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">{children}</p>
    </div>
  );
}
