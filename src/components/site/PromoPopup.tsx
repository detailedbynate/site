import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

import { useBookingModal } from "@/components/booking/BookingModal";
import type { Promo } from "@/lib/promo";

/** Seconds into a visit before the popup appears. */
const DELAY_MS = 10_000;
const VISIT_START = "dbn-visit-start";

/**
 * Next-season reservations popup, on every public page.
 *
 * Shows once per visit: 10 seconds after someone opens the site, and again
 * the next time they come back. Closing it is remembered in sessionStorage,
 * which is cleared when the tab closes, so moving between pages doesn't bring
 * it back. The 10 seconds count from the start of the visit, not each page.
 * Never shown over the booking form.
 */
export function PromoPopup({ promo, image }: { promo: Promo | null; image: string }) {
  const booking = useBookingModal();
  const [open, setOpen] = useState(false);
  const key = promo ? `dbn-promo-${promo.seasonStart}-${promo.percent}` : "";

  useEffect(() => {
    if (!promo?.enabled) return;
    let wait = DELAY_MS;
    try {
      if (sessionStorage.getItem(key)) return;
      const now = Date.now();
      const start = Number(sessionStorage.getItem(VISIT_START)) || now;
      sessionStorage.setItem(VISIT_START, String(start));
      wait = Math.max(0, DELAY_MS - (now - start));
    } catch {
      // Storage blocked (private mode, strict settings): show it once per page.
    }
    const timer = setTimeout(() => setOpen(true), wait);
    return () => clearTimeout(timer);
  }, [promo?.enabled, key]);

  const dismiss = () => {
    setOpen(false);
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      // Nothing to do — it simply shows again on the next page.
    }
  };

  const visible = open && !booking.isOpen && Boolean(promo?.enabled);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && promo && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={dismiss}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="promo-title"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[440px] overflow-hidden rounded-[26px] border border-[var(--estoril)]/60 bg-[#111114] shadow-[0_0_0_1px_rgba(47,107,255,0.25),0_30px_120px_-30px_rgba(47,107,255,0.8)]"
          >
            <button
              type="button"
              aria-label="Close"
              onClick={dismiss}
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative h-48">
              <img src={image} alt="" aria-hidden className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#111114] via-[#111114]/30 to-transparent" />
            </div>

            <div className="px-7 pb-7 text-center">
              <span className="inline-block rounded-full bg-[var(--estoril)] px-3 py-1 text-[12.5px] font-bold text-white">
                Limited time
              </span>
              <h2 id="promo-title" className="mt-4 text-[36px] leading-[1.05]">
                Save <span className="text-[var(--sky)]">{promo.percent}% off</span>
              </h2>
              <p className="mx-auto mt-4 max-w-[34ch] leading-relaxed text-[var(--text-muted)]">
                {promo.popupText}
              </p>
              <button
                type="button"
                onClick={() => {
                  dismiss();
                  booking.open(undefined, { season: true });
                }}
                className="site-btn mt-7 w-full"
              >
                Claim my discount
              </button>
              <p className="mt-4 text-[13px] text-[var(--text-muted)]">
                No code needed — the discount is applied automatically.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
