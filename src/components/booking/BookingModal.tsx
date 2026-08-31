import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

import { BookingWizard } from "./BookingWizard";
import type { ServiceId } from "@/lib/services";

// --------------------------------------------------------------------------
// Booking modal: the wizard as an overlay on top of whatever page you're on,
// so "Book Now" never navigates away. /book still renders the same wizard
// inline for people who land there directly or share the link.
//
// Any component under <BookingModalProvider> can call useBookingModal().open().
// --------------------------------------------------------------------------

type BookingModalContext = {
  /** Pass a package id to open with it preselected (e.g. "Book Diamond"). */
  open: (serviceId?: ServiceId) => void;
  close: () => void;
  isOpen: boolean;
};

const Ctx = createContext<BookingModalContext | null>(null);

export function useBookingModal(): BookingModalContext {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useBookingModal must be used inside <BookingModalProvider>");
  }
  return ctx;
}

export function BookingModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialServiceId, setInitialServiceId] = useState<ServiceId | undefined>();
  // Bumped on every open so the wizard remounts with a clean slate — a second
  // booking shouldn't inherit the first one's answers.
  const [session, setSession] = useState(0);

  const open = useCallback((serviceId?: ServiceId) => {
    setInitialServiceId(serviceId);
    setSession((n) => n + 1);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <BookingModal
        open={isOpen}
        onClose={close}
        session={session}
        initialServiceId={initialServiceId}
      />
    </Ctx.Provider>
  );
}

function BookingModal({
  open,
  onClose,
  session,
  initialServiceId,
}: {
  open: boolean;
  onClose: () => void;
  session: number;
  initialServiceId?: ServiceId;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // Portals need a real document, which doesn't exist during SSR.
  useEffect(() => setMounted(true), []);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock background scroll while the overlay is up, and compensate for the
  // scrollbar's width so the page underneath doesn't visibly shift.
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
    };
  }, [open]);

  // Move focus into the dialog when it opens so keyboard and screen-reader
  // users land inside it rather than back at the top of the page.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 overflow-y-auto overscroll-contain"
          style={{
            backgroundColor: "color-mix(in oklab, var(--brand-deep) 78%, transparent)",
            backdropFilter: "blur(10px)",
          }}
          onClick={onClose}
        >
          <div className="flex min-h-full items-start justify-center p-4 sm:p-6">
            <motion.div
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label="Book a detail"
              initial={{ opacity: 0, y: 28, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 220, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-3xl outline-none"
            >
              <button
                type="button"
                onClick={onClose}
                aria-label="Close booking"
                className="absolute -top-1 right-2 z-10 rounded-full border border-border bg-card/90 p-2 text-foreground backdrop-blur transition hover:border-primary/60 hover:text-primary sm:-right-2 sm:-top-2"
              >
                <X className="h-4 w-4" />
              </button>

              <BookingWizard
                key={session}
                initialServiceId={initialServiceId}
                onDone={onClose}
              />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
