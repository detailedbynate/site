import logo from "@/assets/logo.png";
import { Link, useLoaderData } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Menu, Phone, Star, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import heroCar from "@/assets/hero-car.jpg";
import { useBookingModal } from "@/components/booking/BookingModal";

// Pieces every public page shares: the page width, the header, the footer,
// the booking section and the rating stars. One place, so pages can't drift.

const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** Page width and side padding for every public section. */
export function Container({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`mx-auto w-full max-w-[1240px] px-5 sm:px-8 ${className}`}>{children}</div>;
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const ceramicHidden = useLoaderData({ from: "__root__" })?.meta?.ceramicMode === "hidden";
  return (
    <>
      <Link to="/" hash="packages" onClick={onNavigate} className="site-navlink">
        Packages
      </Link>
      {!ceramicHidden && (
        <Link to="/" hash="ceramic" onClick={onNavigate} className="site-navlink">
          Ceramic
        </Link>
      )}
      <Link to="/" hash="process" onClick={onNavigate} className="site-navlink">
        How it works
      </Link>
      <Link to="/results" onClick={onNavigate} className="site-navlink">
        Results
      </Link>
      <Link to="/" hash="reviews" onClick={onNavigate} className="site-navlink">
        Reviews
      </Link>
      <Link to="/" hash="faq" onClick={onNavigate} className="site-navlink">
        FAQ
      </Link>
    </>
  );
}

/**
 * Announcement bar for next-season reservations, across the very top of every
 * public page. Read from the root route (which loads the site settings), so
 * it's in the server-rendered HTML rather than popping in after load.
 */
function PromoBar() {
  const promo = useLoaderData({ from: "__root__" })?.meta?.promo;
  const booking = useBookingModal();
  if (!promo?.enabled || !promo.barText.trim()) return null;
  return (
    <button
      type="button"
      onClick={() => booking.open(undefined, { season: true })}
      className="group flex min-h-9 w-full items-center justify-center gap-2 bg-[linear-gradient(90deg,#173ea8,#2f6bff_50%,#173ea8)] px-4 py-2 text-center text-[13.5px] font-medium leading-snug text-white"
    >
      <span>{promo.barText}</span>
      <span className="hidden shrink-0 items-center font-bold sm:inline-flex">
        Reserve now
        <ChevronRight
          aria-hidden
          className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </span>
    </button>
  );
}

/** Floating frosted bar over the page. */
export function SiteNav({ phone }: { phone?: string | null }) {
  const booking = useBookingModal();
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <PromoBar />
      <div className="px-3 pt-3 sm:px-5 sm:pt-4">
      <div className="mx-auto max-w-[1240px] rounded-[18px] border border-white/10 bg-[#0a0a0c]/55 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6">
          <Link to="/" className="site-wordmark flex items-center gap-2 whitespace-nowrap text-[17px] sm:text-[18px]">
            <img src={logo} alt="Detailed by Nate" className="h-7 w-auto sm:h-8" />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
            <NavLinks />
          </nav>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {phone && (
              <a href={tel(phone)} className="site-navlink hidden items-center gap-2 xl:inline-flex">
                <Phone aria-hidden className="h-4 w-4" />
                {phone}
              </a>
            )}
            <button type="button" onClick={() => booking.open()} className="site-btn site-btn-sm">
              Book now
            </button>
            <button
              type="button"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-white/15 bg-white/5 text-white lg:hidden"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={open ? "close" : "open"}
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="flex"
                >
                  {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.nav
              key="mobile-menu"
              aria-label="Main"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden lg:hidden"
            >
              <motion.div
                initial={{ y: -10 }}
                animate={{ y: 0 }}
                exit={{ y: -10 }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col gap-5 border-t border-white/10 px-4 py-6 sm:px-6"
              >
                <NavLinks onNavigate={() => setOpen(false)} />
                {phone && (
                  <a href={tel(phone)} className="site-navlink inline-flex items-center gap-2">
                    <Phone aria-hidden className="h-4 w-4" />
                    {phone}
                  </a>
                )}
              </motion.div>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
      </div>
    </header>
  );
}

export function SiteFooter({
  phone,
  email,
  area,
}: {
  phone?: string | null;
  email?: string | null;
  area?: string | null;
}) {
  const booking = useBookingModal();
  const link = "transition-colors hover:text-white";
  const ceramicHidden = useLoaderData({ from: "__root__" })?.meta?.ceramicMode === "hidden";
  return (
    <footer className="border-t border-[var(--line)]">
      <Container className="grid gap-12 py-16 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <p className="site-wordmark flex items-center gap-2 text-[20px]">
            <img src={logo} alt="Detailed by Nate" className="h-7 w-auto sm:h-8" />
          </p>
          <p className="mt-4 max-w-[36ch] leading-relaxed text-[var(--text-muted)]">
            Mobile and drop-off{" "}
            <Link to="/" className="underline decoration-white/25 underline-offset-4 hover:text-white">
              car detailing in the {area || "Sault Ste. Marie area"}
            </Link>
            . Booked online, done by hand.
          </p>
          <button type="button" onClick={() => booking.open()} className="site-btn site-btn-sm mt-7">
            Book now
          </button>
        </div>

        <div>
          <p className="site-label text-[var(--text)]">Explore</p>
          {/* Two short columns instead of one long one. */}
          <div className="mt-5 grid grid-cols-2 gap-x-10">
          <ul className="space-y-3 text-[15px] text-[var(--text-muted)]">
            <li>
              <Link to="/" hash="packages" className={link}>Packages</Link>
            </li>
            <li>
              <Link to="/prices" className={link}>Prices</Link>
            </li>
            <li>
              <Link to="/mobile-detailing" className={link}>Mobile detailing</Link>
            </li>
            <li>
              <Link to="/interior-detailing" className={link}>Interior detailing</Link>
            </li>
          </ul>
          <ul className="space-y-3 text-[15px] text-[var(--text-muted)]">
            {!ceramicHidden && (
              <li>
                <Link to="/" hash="ceramic" className={link}>Ceramic coating</Link>
              </li>
            )}
            <li>
              <Link to="/" hash="process" className={link}>How it works</Link>
            </li>
            <li>
              <Link to="/results" className={link}>Results</Link>
            </li>
            <li>
              <Link to="/" hash="reviews" className={link}>Reviews</Link>
            </li>
            <li>
              <Link to="/" hash="faq" className={link}>FAQ</Link>
            </li>
          </ul>
          </div>
        </div>

        <div>
          <p className="site-label text-[var(--text)]">Contact</p>
          <ul className="mt-5 space-y-3 text-[15px] text-[var(--text-muted)]">
            {phone && (
              <li>
                <a href={tel(phone)} className={link}>{phone}</a>
              </li>
            )}
            {email && (
              <li>
                <a href={`mailto:${email}`} className={`${link} break-all`}>{email}</a>
              </li>
            )}
            <li>Sault Ste. Marie, Ontario</li>
            <li>
              <Link to="/book" className={link}>Book online</Link>
            </li>
          </ul>
        </div>
      </Container>

      <div className="border-t border-[var(--line)]">
        <Container className="flex flex-col gap-3 py-6 text-[13.5px] text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Detailed by Nate. All rights reserved.</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link to="/privacy" className={link}>Privacy</Link>
            <Link to="/terms" className={link}>Terms</Link>
            {/* The owner's way in. Quiet on purpose — customers don't need it. */}
            <Link to="/login" className={link}>Staff login</Link>
          </nav>
        </Container>
      </div>
    </footer>
  );
}

/** Closing call to action: a frosted panel over a photo. */
export function BookingBand({
  phone,
  email,
  area,
  title = "Ready to look brand new?",
  text = "Book a slot in under 60 seconds. I'll confirm the same day.",
}: {
  phone?: string | null;
  email?: string | null;
  area?: string | null;
  title?: string;
  text?: string;
}) {
  const booking = useBookingModal();
  return (
    <section id="book" className="relative isolate scroll-mt-24 overflow-hidden">
      <img
        src={heroCar}
        alt=""
        aria-hidden
        loading="lazy"
        className="absolute inset-0 -z-20 h-full w-full object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(10,10,12,0.88)_0%,rgba(10,10,12,0.55)_55%,rgba(10,10,12,0.35)_100%)]"
      />
      <Container className="py-24 md:py-32">
        <div className="site-glass max-w-[640px] rounded-[26px] p-8 md:p-12">
          <p className="site-label text-[var(--sky)]">Book online</p>
          <h2 className="mt-3 text-[clamp(2.3rem,5vw,3.9rem)] leading-[1]">{title}</h2>
          <p className="mt-5 max-w-[44ch] text-[18px] leading-relaxed text-white/75">{text}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" onClick={() => booking.open()} className="site-btn">
              Book your detail
            </button>
            {phone && (
              <a href={tel(phone)} className="site-btn-quiet">
                <Phone aria-hidden className="h-4 w-4" />
                Call {phone}
              </a>
            )}
          </div>
          {(email || area) && (
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 border-t border-white/10 pt-6 text-[15px] text-white/70">
              {email && (
                <a href={`mailto:${email}`} className="transition-colors hover:text-white">
                  {email}
                </a>
              )}
              {area && <span>{area}</span>}
            </div>
          )}
        </div>
      </Container>
    </section>
  );
}

export function Stars({ count = 5, className = "" }: { count?: number; className?: string }) {
  return (
    <span className={`inline-flex gap-0.5 ${className}`} role="img" aria-label={`${count} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          aria-hidden
          className={`h-4 w-4 ${i < count ? "fill-current" : "opacity-25"}`}
        />
      ))}
    </span>
  );
}
