import { createFileRoute, Link } from "@tanstack/react-router";
import {
  MotionConfig,
  animate,
  motion,
  useInView,
  useMotionValue,
  useTransform,
} from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Check, Droplets, Phone, Plus, ShieldCheck, Snowflake } from "lucide-react";

import heroCar from "@/assets/hero-car.jpg";
import serviceDiamond from "@/assets/service-diamond.jpg";
import serviceGold from "@/assets/service-gold.jpg";
import serviceSilver from "@/assets/service-silver.jpg";
import { BeforeAfter } from "@/components/BeforeAfter";
import { useBookingModal } from "@/components/booking/BookingModal";
import { PromoPopup } from "@/components/site/PromoPopup";
import {
  BookingBand,
  Container,
  SiteFooter,
  SiteNav,
  Stars,
} from "@/components/site/SiteChrome";
import { getCatalog, getHomeSchema, getPublicGallery } from "@/lib/api/booking.functions";
import {
  getHeroImage,
  getPublicFaqs,
  getPublicTestimonials,
} from "@/lib/api/content.functions";
import { isCoatingService, type ServiceId } from "@/lib/services";

export const Route = createFileRoute("/")({
  // No head override here on purpose: the homepage's title and description
  // come from the root route, which reads them from /admin/seo. A hardcoded
  // title here would silently win and make that page look broken.
  //
  // Pricing is loaded (not hardcoded) so editing a package in the admin
  // updates this page too. Loading rather than fetching client-side means
  // the right price is in the HTML on first paint, with no flash of a stale
  // number and nothing for a crawler to read wrong.
  loader: async () => {
    try {
      const [catalog, gallery, reviews, faq, hero, schema] = await Promise.all([
        getCatalog(),
        getPublicGallery(),
        getPublicTestimonials(),
        getPublicFaqs(),
        getHeroImage(),
        getHomeSchema().catch(() => null),
      ]);
      return {
        services: catalog.services,
        ceramicMode: catalog.ceramicMode,
        coatingPreview: catalog.coatingPreview,
        ceramicCopy: catalog.ceramicCopy,
        travelFee: catalog.travelFee,
        promo: catalog.promo,
        business: catalog.business,
        gallery: gallery.pairs,
        reviews: reviews.testimonials,
        faqs: faq.faqs,
        hero,
        schema,
      };
    } catch {
      return {
        services: null,
        ceramicMode: "hidden" as const,
        coatingPreview: [],
        ceramicCopy: null,
        travelFee: 0,
        promo: null,
        business: null,
        gallery: [],
        reviews: [],
        faqs: [],
        hero: null,
        schema: null,
      };
    }
  },
  // Title and description come from the root (Admin → SEO). This adds the
  // page's own canonical URL and its structured data.
  head: ({ loaderData }) => {
    const origin = loaderData?.schema?.origin ?? "https://detailedbynate.com";
    return {
      meta: [{ property: "og:url", content: `${origin}/` }],
      links: [{ rel: "canonical", href: `${origin}/` }],
      scripts: loaderData?.schema
        ? [{ type: "application/ld+json", children: loaderData.schema.json }]
        : [],
    };
  },
  component: Index,
});

function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.floor(v).toLocaleString());
  // Server HTML carries the real number, which is what crawlers read. The
  // browser resets to 0 and counts up while the stats bar is still hidden.
  const [display, setDisplay] = useState(() => to.toLocaleString());
  const started = useRef(false);

  useLayoutEffect(() => {
    if (started.current) return;
    setDisplay("0");
  }, []);

  useEffect(() => {
    if (!inView) return;
    started.current = true;
    const controls = animate(count, to, { duration: 2.2, ease: [0.16, 1, 0.3, 1] });
    const unsub = rounded.on("change", setDisplay);
    return () => { controls.stop(); unsub(); };
  }, [inView, to, count, rounded]);

  return <span ref={ref}>{display}{suffix}</span>;
}

/**
 * Layout order, imagery and fallback copy for each package. Price, title,
 * blurb, features and duration come from the database and are merged in
 * below by id — anything the admin can edit must NOT be relied on from here.
 * The photos are placeholders until real ones are uploaded.
 */
const serviceCards = [
  {
    id: "diamond",
    image: serviceDiamond,
    title: "Diamond",
    subtitle: "Interior & Exterior",
    priceValue: 399,
    desc: "The full obsession. Two-bucket exterior decon wash, clay bar and seal, plus a complete interior reset — steam, leather conditioning, and every vent detailed.",
    features: ["Full exterior decon + wax", "Complete interior deep clean", "Tire & trim dressing", "Glass + jambs"],
    popular: true,
  },
  {
    id: "gold",
    image: serviceGold,
    title: "Gold",
    subtitle: "Interior",
    priceValue: 199,
    desc: "Cabin restored to factory-fresh. Steam extraction on carpets and seats, leather conditioned, every crevice, vent and stitch line touched by hand.",
    features: ["Steam extraction", "Leather condition", "Vents + crevices", "Glass interior"],
    popular: false,
  },
  {
    id: "silver",
    image: serviceSilver,
    title: "Silver",
    subtitle: "Exterior",
    priceValue: 149,
    desc: "A proper hand wash that protects your paint. Foam pre-soak, two-bucket method, wheels degreased, and a sealant for that deep wet shine.",
    features: ["Foam pre-soak", "Two-bucket hand wash", "Wheels + tires", "Spray sealant"],
    popular: false,
  },
];

const steps = [
  { title: "Choose a package", text: "Diamond, Gold or Silver, plus any add-ons you want." },
  { title: "Pick a time", text: "Open slots are live, so booking takes about a minute." },
  {
    title: "Drop off or stay home",
    text: "Drop it off with me, or I come to your home or work.",
  },
  {
    title: "Drive away showroom-ready",
    text: "Every package includes a pre-detail inspection, so nothing gets missed.",
  },
];

const fallbackReviews = [
  { name: "Marcus T.", car: "BMW M4 Competition", rating: 5, text: "Nate transformed my M4. Paint correction was flawless — looks better than the day I drove it off the lot. Genuine craftsman." },
  { name: "Sofia R.", car: "Tesla Model 3", rating: 5, text: "Booked the ceramic coating package. Water beads off like magic and the interior smells brand new. Worth every dollar." },
  { name: "Devon K.", car: "Ford F-150 Raptor", rating: 5, text: "Truck was a mud-caked disaster after a weekend in Moab. Came back showroom clean inside and out. Insane attention to detail." },
  { name: "Aisha P.", car: "Porsche 911 Carrera", rating: 5, text: "I'm picky about who touches my 911. Nate is the only detailer I trust now. Hand wash, no swirl marks, perfect every visit." },
  { name: "Jordan L.", car: "Audi RS5", rating: 5, text: "On-time, professional, and the results speak for themselves. The deep interior clean pulled stains I thought were permanent." },
  { name: "Riley M.", car: "Jeep Wrangler", rating: 5, text: "Got the full detail before selling — sold it for $2k over asking. Buyers couldn't believe the condition. Thanks Nate." },
];

const fallbackFaqs = [
  { q: "How long does a full detail take?", a: "A standard full detail runs 3–5 hours depending on vehicle size and condition. Ceramic coatings require an additional cure day." },
  { q: "Do you come to me?", a: "Yes — mobile service is available throughout the area. I bring every product and tool needed." },
  { q: "What's included in the ceramic coating package?", a: "Full decontamination wash, clay bar, single-stage paint correction, panel wipe, and a professional 9H ceramic coating with warranty." },
  { q: "How should I prepare my vehicle?", a: "Just remove personal belongings. I handle everything else — from cup-holder gunk to dog hair embedded in the seats." },
  { q: "Do you offer maintenance packages?", a: "Absolutely. Monthly and bi-weekly maintenance plans keep your finish protected and save you money long-term." },
];

/** "About 4 hours" reads better than "240 minutes". Half-hour precision. */
function formatDuration(minutes?: number): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.round((minutes / 60) * 2) / 2;
  return `${h} hour${h === 1 ? "" : "s"}`;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((n) => n[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

/**
 * The hero settles in, in order, once. Nothing else on the page animates on
 * its own — sections below simply appear as you scroll.
 */
const rise = (delay: number) => ({
  initial: { opacity: 0, y: 22 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
});

function SectionHeading({ label, title }: { label: string; title: string }) {
  return (
    <div>
      <p className="site-label text-[var(--sky)]">{label}</p>
      <h2 className="mt-3 text-[clamp(2.2rem,4.6vw,3.75rem)] leading-[1]">{title}</h2>
    </div>
  );
}

function Index() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const booking = useBookingModal();
  const {
    services: liveServices,
    ceramicMode,
    coatingPreview,
    ceramicCopy,
    travelFee,
    promo,
    business,
    gallery,
    reviews: liveReviews,
    faqs: liveFaqs,
    hero,
  } = Route.useLoaderData();

  // Hero copy and the counters are editable in SEO & branding. The literals
  // here are only a fallback for a fresh install.
  const heroUrl = hero?.url ?? null;
  // The city name never breaks across lines in the big headline.
  const keepCity = (t: string) => t.replace(/Sault Ste\. Marie/g, "Sault Ste. Marie");
  const heroHeadline = keepCity(hero?.headline || "Make your car");
  const heroAccent = keepCity(hero?.headlineAccent || "look untouchable.");
  const heroSubtext =
    hero?.subtext ||
    "Hand car detailing in Sault Ste. Marie, inside and out. Drop it off with me, or I come to you.";
  // The badge and pills are also editable, and blank is meaningful there:
  // it hides that piece. So a stored "" wins; the literals are only for when
  // the hero failed to load at all.
  const heroBadge = hero ? hero.badge : "Now booking — Summer detail season";
  const heroPill = hero ? hero.pill : "No deposit · Mobile or drop-off · Sault Ste. Marie";
  const statPills = [
    {
      value: hero?.statClients ?? 150,
      suffix: "+",
      label: hero ? hero.statClientsLabel : "clients served",
    },
    { value: 5, suffix: ".0", label: hero ? hero.statRatingLabel : "star rating", stars: true },
    {
      value: hero?.statVehicles ?? 200,
      suffix: "+",
      label: hero ? hero.statVehiclesLabel : "vehicles detailed",
    },
  ].filter((s) => s.label.trim());

  // Both editable in the admin; the bundled versions are only a fallback for
  // a fresh install whose tables somehow came back empty.
  const faqs = liveFaqs?.length ? liveFaqs : fallbackFaqs;
  const reviews = liveReviews?.length ? liveReviews : fallbackReviews;
  const ratings = reviews.map((r) => r.rating);
  const reviewTotal = hero?.reviewTotal ?? 15;
  const average = ratings.length ? ratings.reduce((s, n) => s + n, 0) / ratings.length : 5;

  // Only the shop's own uploaded work (Admin -> SEO & branding). The whole
  // section hides when there is nothing real to show.
  const shownPairs = (gallery ?? []).filter((g) => g.beforeUrl && g.afterUrl).slice(0, 2);

  // Contact details are editable in Settings, so they're read rather than
  // hardcoded — otherwise changing them there would silently do nothing.
  const phone = business?.phone ?? "(555) 123-4567";
  const email = business?.email ?? "book@detailedbynate.com";
  const area = business?.serviceArea ?? "Sault Ste. Marie area";
  const tel = `tel:${phone.replace(/[^\d+]/g, "")}`;

  // Merge live catalog values over the local presets. A package that has
  // been deactivated in the admin drops off the homepage entirely, so the
  // site never advertises something nobody can book.
  const services = serviceCards
    .map((card) => {
      const live = liveServices?.find((s) => s.id === card.id);
      if (liveServices && !live) return null;
      return {
        ...card,
        // An uploaded photo (Admin -> Services) replaces the bundled one.
        image: hero?.serviceImages?.[card.id] ?? card.image,
        title: live?.title ?? card.title,
        subtitle: live?.subtitle ?? card.subtitle,
        priceValue: live?.priceValue ?? card.priceValue,
        desc: live?.description || card.desc,
        features: live?.features?.length ? live.features : card.features,
        duration: formatDuration(live?.durationMinutes),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const statCells = statPills.length + (heroPill.trim() ? 1 : 0);

  // Ceramic coating tiers, straight from the catalog so price, time and
  // wording are edited under Services like any package.
  // "Coming soon" shows the tiers without prices or a way to book them.
  const coatingsOpen = ceramicMode === "open";
  const coatings: {
    id: string;
    title: string;
    subtitle: string;
    priceValue?: number;
    durationMinutes?: number;
    features: string[];
    description: string;
  }[] =
    ceramicMode === "hidden"
      ? []
      : coatingsOpen
        ? (liveServices ?? []).filter((s) => isCoatingService(s.id))
        : coatingPreview;

  return (
    <MotionConfig reducedMotion="user">
      <div className="site min-h-screen overflow-x-clip">
        <SiteNav phone={phone} />
        <PromoPopup promo={promo} image={heroUrl ?? heroCar} />

        {/* Hero — full-bleed photo with frosted panels over it. An uploaded
            hero photo (SEO & branding) replaces the placeholder. */}
        <section
          id="top"
          className="relative isolate flex min-h-[100svh] flex-col justify-end overflow-hidden pb-8 pt-44 md:pb-12"
        >
          {hero?.videoUrl ? (
            // A hero video (SEO & branding) plays silently on loop; the
            // photo is its poster while it loads.
            <video
              src={hero.videoUrl}
              poster={heroUrl ?? heroCar}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              aria-hidden
              className="absolute inset-0 -z-20 h-full w-full object-cover"
            />
          ) : (
            <motion.img
              src={heroUrl ?? heroCar}
              alt="Car detailing in Sault Ste. Marie by Detailed by Nate"
              initial={{ scale: 1.06 }}
              animate={{ scale: 1 }}
              transition={{ duration: 1.8, ease: "easeOut" }}
              className="absolute inset-0 -z-20 h-full w-full object-cover"
            />
          )}
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(10,10,12,0.92)_0%,rgba(10,10,12,0.72)_45%,rgba(10,10,12,0.25)_100%)]"
          />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 -z-10 h-56 bg-gradient-to-t from-[var(--ink)] to-transparent"
          />

          <Container>
            {heroBadge && (
              <motion.p
                {...rise(0)}
                className="site-glass inline-flex items-center gap-2.5 rounded-full px-4 py-2 text-[14px] text-white/90"
              >
                <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--estoril)] shadow-[0_0_10px_var(--estoril)]" />
                {heroBadge}
              </motion.p>
            )}
            <h1
              className={`mt-6 leading-[0.98] ${
                (heroHeadline + heroAccent).length > 34
                  ? "max-w-[18ch] text-[clamp(2.5rem,5.4vw,4.9rem)]"
                  : "max-w-[14ch] text-[clamp(2.9rem,7vw,6.25rem)]"
              }`}
            >
              <motion.span {...rise(0.06)} className="block">
                {heroHeadline}
              </motion.span>{" "}
              <motion.span {...rise(0.14)} className="block">
                {heroAccent}
              </motion.span>
            </h1>
            <motion.p
              {...rise(0.22)}
              className="mt-6 max-w-[52ch] text-[17px] leading-relaxed text-white/75 md:text-[19px]"
            >
              {heroSubtext}
            </motion.p>
            <motion.div {...rise(0.3)} className="mt-9 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => booking.open()} className="site-btn">
                Book your detail <ArrowRight aria-hidden className="h-4 w-4" />
              </button>
              <a href="#packages" className="site-btn-quiet">
                View packages
              </a>
              <a
                href={tel}
                className="site-display ml-1 inline-flex items-center gap-2 px-2 text-[17px] text-white transition-colors hover:text-[var(--sky)]"
              >
                <Phone aria-hidden className="h-4 w-4" />
                {phone}
              </a>
            </motion.div>

            {/* Frosted stats bar over the photo — the editable counters. */}
            {statCells > 0 && (
              <motion.dl
                {...rise(0.4)}
                className={`site-glass mt-14 grid grid-cols-2 overflow-hidden rounded-[22px] md:mt-20 ${
                  statCells >= 4 ? "md:grid-cols-4" : statCells === 3 ? "md:grid-cols-3" : "md:grid-cols-2"
                }`}
              >
                {statPills.map((s) => (
                  <div
                    key={s.label}
                    className="flex flex-col-reverse border-white/10 px-6 py-6 md:border-l md:first:border-l-0"
                  >
                    <dt className="mt-1.5 text-[14px] text-white/65">{s.label}</dt>
                    <dd className="flex items-center gap-3">
                      <span className="site-display tnum text-[clamp(1.9rem,3.4vw,2.6rem)] leading-none">
                        <Counter to={s.value} suffix={s.suffix} />
                      </span>
                      {s.stars && <Stars className="hidden text-[var(--amber)] sm:inline-flex" />}
                    </dd>
                  </div>
                ))}
                {heroPill.trim() && (
                  <div className="col-span-2 flex items-center border-t border-white/10 px-6 py-6 md:col-span-1 md:border-l md:border-t-0">
                    <p className="text-[15px] font-medium leading-snug text-white/85">{heroPill}</p>
                  </div>
                )}
              </motion.dl>
            )}
          </Container>
        </section>

        {/* Packages */}
        <section id="packages" className="site-glow scroll-mt-24">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[58%] -z-10 h-[560px] w-[min(1000px,100%)] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(closest-side,rgba(47,107,255,0.2),transparent)]"
          />
          <Container className="py-24 md:py-32">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHeading label="Packages" title="Which detailing package do I need?" />
              <p className="max-w-[44ch] leading-relaxed text-[var(--text-muted)]">
                Every package is done by hand.
                {travelFee > 0 && ` Mobile service adds $${travelFee} for travel.`} Add-ons are
                chosen when you book.
              </p>
            </div>

            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {services.map((s) => (
                <article
                  key={s.id}
                  className={`site-card group relative isolate flex flex-col rounded-[24px] p-2.5 site-lift ${
                    s.popular
                      ? "border-[var(--estoril)]/80 shadow-[0_0_0_1px_rgba(47,107,255,0.35),0_30px_90px_-30px_rgba(47,107,255,0.85)]"
                      : "shadow-[0_24px_70px_-34px_rgba(47,107,255,0.55)] hover:border-[var(--sky)]/40"
                  }`}
                >
                  {/* The stronger hover glow, faded in. Fading a ready-made
                      shadow is cheap; animating the shadow itself repaints a
                      100px blur on every frame. */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 -z-10 rounded-[24px] opacity-0 shadow-[0_40px_110px_-26px_rgba(47,107,255,0.95)] transition-opacity duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:opacity-100"
                  />
                  {/* Light catching the top edge of the glass. */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[var(--sky)] to-transparent opacity-70"
                  />
                  {/* A soft blue bloom from the top that brightens on hover. */}
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute inset-0 rounded-[24px] bg-[radial-gradient(120%_60%_at_50%_0%,rgba(47,107,255,0.2),transparent_60%)] transition-opacity duration-300 group-hover:opacity-100 ${
                      s.popular ? "opacity-100" : "opacity-50"
                    }`}
                  />
                  <div className="relative aspect-[16/10] overflow-hidden rounded-[17px]">
                    <img
                      src={s.image}
                      alt={`${s.title} detailing package: ${s.subtitle}`}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform group-hover:scale-[1.05]"
                    />
                    {s.popular && (
                      <span className="site-glass absolute left-3 top-3 rounded-full bg-[var(--estoril)]/80 px-3 py-1 text-[13px] font-bold text-white">
                        Most popular
                      </span>
                    )}
                  </div>

                  <div className="relative flex flex-1 flex-col px-5 pb-5 pt-6">
                    <p className="text-[14px] text-[var(--sky)]">{s.subtitle}</p>
                    <h3 className="mt-1.5 text-[30px] leading-none">{s.title}</h3>
                    <p className="site-display tnum mt-6 text-[46px] leading-none">${s.priceValue}</p>
                    <p className="mt-2 text-[14px] text-[var(--text-muted)]">
                      Starting price{s.duration ? ` · about ${s.duration}` : ""}
                    </p>
                    <p className="mt-5 text-[15.5px] leading-relaxed text-[var(--text-muted)]">{s.desc}</p>
                    <ul className="mt-5 space-y-2.5 border-t border-white/10 pt-5 text-[15px]">
                      {s.features.map((f) => (
                        <li key={f} className="flex gap-2.5">
                          <Check aria-hidden className="mt-[3px] h-4 w-4 shrink-0 text-[var(--sky)]" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto pt-8">
                      <button
                        type="button"
                        onClick={() => booking.open(s.id as ServiceId)}
                        className={`${s.popular ? "site-btn" : "site-btn-quiet"} w-full`}
                      >
                        Book {s.title}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <p className="mt-10 max-w-[80ch] text-[15px] leading-relaxed text-[var(--text-muted)]">
              If the inside took the beating, book Gold. If it's mostly the outside, book Silver,
              and if it's both, which it usually is after winter, book Diamond. See all{" "}
              <Link to="/prices" className="font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                car detailing prices
              </Link>
              , or read about{" "}
              <Link to="/mobile-detailing" className="font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                mobile car detailing
              </Link>{" "}
              and{" "}
              <Link to="/interior-detailing" className="font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                interior car detailing
              </Link>
              .
            </p>
          </Container>
        </section>

        {/* Ceramic coating — a separate offer from the detail packages: priced
            and timed differently, and (while next-season reservations run)
            booked only for the season. Hidden if every tier is switched off. */}
        {coatings.length > 0 && (
          <section id="ceramic" className="site-glow scroll-mt-24 border-t border-[var(--line)]">
            <Container className="py-24 md:py-32">
              <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-end">
                <div>
                  <span className="inline-flex items-center rounded-full bg-[var(--estoril)]/15 px-3 py-1 text-[13px] font-bold text-[var(--sky)] ring-1 ring-inset ring-[var(--estoril)]/40">
                    {coatingsOpen
                      ? `New for ${promo?.enabled ? promo.seasonLabel : "2027"}`
                      : "Coming soon"}
                  </span>
                  <h2 className="mt-4 text-[clamp(2.2rem,4.6vw,3.75rem)] leading-[1]">Ceramic coating</h2>
                  {ceramicCopy?.intro && (
                    <p className="mt-5 max-w-[50ch] leading-relaxed text-[var(--text-muted)]">
                      {ceramicCopy.intro}
                    </p>
                  )}
                </div>
                <ul className="grid gap-3 sm:grid-cols-3">
                  {[ShieldCheck, Droplets, Snowflake]
                    .map((icon, i) => ({ icon, text: ceramicCopy?.points?.[i]?.trim() ?? "" }))
                    .filter((p) => p.text)
                    .map(({ icon: Icon, text }) => (
                    <li key={text} className="site-glass rounded-[18px] p-5">
                      <Icon aria-hidden className="h-5 w-5 text-[var(--sky)]" />
                      <p className="mt-3 text-[15px] leading-snug">{text}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-14 grid gap-5 md:grid-cols-3">
                {coatings.map((c, i) => {
                  const featured = c.id === "ceramic-3yr";
                  // Rising metals by protection: platinum, sapphire, gold.
                  const tier = (["platinum", "sapphire", "gold"] as const)[Math.min(i, 2)]!;
                  const duration = formatDuration(c.durationMinutes);
                  return (
                    <article
                      key={c.id}
                      className={`site-card-premium tier-${tier} group relative isolate flex flex-col rounded-[24px] p-7 site-lift ${
                        featured ? "site-card-premium-featured" : ""
                      }`}
                    >
                      <span
                        aria-hidden
                        className="tier-glow pointer-events-none absolute inset-0 -z-10 rounded-[24px] opacity-0 transition-opacity duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:opacity-100"
                      />
                      <span
                        aria-hidden
                        className="tier-line pointer-events-none absolute inset-x-8 top-0 h-px opacity-80"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <p className="tier-name text-[13px] font-bold capitalize tracking-wide">{tier}</p>
                        {featured && (
                          <span className="tier-chip rounded-full px-2.5 py-0.5 text-[12px] font-bold">
                            Most popular
                          </span>
                        )}
                      </div>
                      <p className="tier-text mt-3 text-[14px]">{c.subtitle}</p>
                      <h3 className="mt-1.5 text-[28px] leading-none">{c.title}</h3>
                      {coatingsOpen ? (
                        <>
                          <p className="site-display tnum mt-6 text-[46px] leading-none">${c.priceValue}</p>
                          <p className="mt-2 text-[14px] text-[var(--text-muted)]">
                            Starting price{duration ? ` · about ${duration}` : ""}
                          </p>
                        </>
                      ) : (
                        <p className="mt-6 text-[15px] text-[var(--text-muted)]">Pricing coming soon</p>
                      )}
                      {c.description && (
                        <p className="mt-5 text-[15.5px] leading-relaxed text-[var(--text-muted)]">
                          {c.description}
                        </p>
                      )}
                      {c.features.length > 0 && (
                        <ul className="mt-5 space-y-2.5 border-t border-white/10 pt-5 text-[15px]">
                          {c.features.map((f) => (
                            <li key={f} className="flex gap-2.5">
                              <Check aria-hidden className="tier-text mt-[3px] h-4 w-4 shrink-0" />
                              {f}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-auto pt-8">
                        {coatingsOpen ? (
                          <button
                            type="button"
                            onClick={() =>
                              booking.open(c.id as ServiceId, { season: Boolean(promo?.enabled) })
                            }
                            className={`${featured ? "site-btn" : "site-btn-quiet"} w-full`}
                          >
                            {promo?.enabled ? `Reserve ${c.title}` : `Book ${c.title}`}
                          </button>
                        ) : (
                          <p className="rounded-full border border-white/10 py-3 text-center text-[15px] text-[var(--text-muted)]">
                            Reservations open soon
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              <p className="mt-8 max-w-[80ch] text-[14px] leading-relaxed text-[var(--text-muted)]">
                {ceramicCopy?.note}
                {coatingsOpen && promo?.enabled &&
                  ` Reserve for the ${promo.seasonLabel} and get ${promo.percent}% off automatically.`}
              </p>
            </Container>
          </section>
        )}

        {/* How it works — a real sequence, so it's numbered. */}
        <section id="process" className="site-glow scroll-mt-24 border-y border-[var(--line)]">
          <Container className="py-24 md:py-28">
            <SectionHeading label="How it works" title="Booked in a minute. Done by hand." />
            <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, i) => {
                const delay = i * 0.15;
                const inView = { once: true, amount: 0.35 } as const;
                return (
                  <motion.li
                    key={step.title}
                    initial={{ opacity: 0, y: 44 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={inView}
                    transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
                    className="site-card relative overflow-hidden rounded-[22px] p-7"
                  >
                    <motion.span
                      initial={{ scale: 0.4, opacity: 0 }}
                      whileInView={{ scale: 1, opacity: 1 }}
                      viewport={inView}
                      transition={{ type: "spring", stiffness: 320, damping: 16, delay: delay + 0.25 }}
                      className="site-display flex h-10 w-10 items-center justify-center rounded-full bg-[var(--estoril)] text-[16px] text-white shadow-[0_0_24px_-4px_var(--estoril)]"
                    >
                      {i + 1}
                    </motion.span>
                    <h3 className="mt-6 text-[21px] leading-tight">{step.title}</h3>
                    <p className="mt-3 leading-relaxed text-[var(--text-muted)]">{step.text}</p>
                    <motion.span
                      aria-hidden
                      initial={{ scaleX: 0 }}
                      whileInView={{ scaleX: 1 }}
                      viewport={inView}
                      transition={{ duration: 0.9, delay: delay + 0.35, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-gradient-to-r from-[var(--estoril)] to-[var(--sky)]"
                    />
                  </motion.li>
                );
              })}
            </ol>
          </Container>
        </section>

        {/* Before & after. Hidden entirely until there's real work to show. */}
        {shownPairs.length > 0 && (
          <section id="results">
            <Container className="py-24 md:py-32">
              <div className="flex flex-wrap items-end justify-between gap-6">
                <SectionHeading label="Results" title="Before and after" />
                <Link to="/results" className="site-btn-quiet site-btn-sm">
                  See more before-and-after detailing results
                </Link>
              </div>
              <p className="mt-5 text-[var(--text-muted)]">Drag the handle to compare.</p>
              <div className="mt-10 grid gap-6 md:grid-cols-2">
                {shownPairs.map((g) => (
                  <BeforeAfter
                    key={g.id}
                    before={g.beforeUrl as string}
                    after={g.afterUrl as string}
                    label={g.label}
                  />
                ))}
              </div>
            </Container>
          </section>
        )}

        {/* Reviews */}
        <section id="reviews" className="site-glow scroll-mt-24">
          <Container className="py-24 md:py-32">
            <div className="flex flex-wrap items-end justify-between gap-8">
              <SectionHeading label="Reviews" title="What do Sault customers say?" />
              <div className="site-glass flex items-center gap-4 rounded-[18px] px-5 py-4">
                <span className="site-display tnum text-[42px] leading-none">{average.toFixed(1)}</span>
                <div>
                  <Stars count={Math.round(average)} className="text-[var(--amber)]" />
                  <p className="mt-1 text-[13.5px] text-[var(--text-muted)]">
                    {reviewTotal} five-star reviews on{" "}
                    {hero?.googleReviewsUrl ? (
                      <a href={hero.googleReviewsUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                        Google
                      </a>
                    ) : (
                      "Google"
                    )}{" "}
                    and{" "}
                    {hero?.facebookUrl ? (
                      <a href={hero.facebookUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                        Facebook
                      </a>
                    ) : (
                      "Facebook"
                    )}
                  </p>
                </div>
              </div>
            </div>

            <ul className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {reviews.map((r, i) => (
                <li key={i} className="site-glass flex flex-col rounded-[22px] p-7">
                  <Stars count={r.rating} className="text-[var(--amber)]" />
                  <blockquote className="mt-4 flex-1 text-[16.5px] leading-relaxed text-white/90">
                    “{r.text}”
                  </blockquote>
                  <div className="mt-6 flex items-center gap-3 border-t border-white/10 pt-5">
                    <span className="site-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--estoril)] text-[14px] text-white">
                      {initials(r.name)}
                    </span>
                    <div>
                      <p className="font-bold">{r.name}</p>
                      {r.car && <p className="text-[14px] text-[var(--text-muted)]">{r.car}</p>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Container>
        </section>

        {/* Winter: the angle the whole page is written around (draft.md). */}
        <section id="winter" className="scroll-mt-24 border-t border-[var(--line)]">
          <Container className="grid gap-10 py-24 md:py-28 lg:grid-cols-[1fr_1.2fr] lg:items-start">
            <h2 className="max-w-[16ch] text-[clamp(2.2rem,4.6vw,3.75rem)] leading-[1]">
              What does winter do to a car in Sault Ste. Marie?
            </h2>
            <div className="max-w-[62ch] space-y-5 text-[17px] leading-relaxed text-[var(--text-muted)]">
              <p>
                It packs road salt and sand into every carpet, mat and seam, and leaves a film of
                grime on the paint that a quick car wash doesn't fully lift. The longer it sits, the
                harder it is to get out, and salt left on metal speeds up rust.
              </p>
              <p>
                The Sault gets about{" "}
                <a
                  href="https://www.currentresults.com/Weather/Canada/Ontario/snowfall-annual-average.php"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
                >
                  320 cm of snow a year on Environment Canada's climate normals
                </a>
                , so the roads stay salted for months. AAA estimated that American drivers spent{" "}
                <a
                  href="https://www.thedrive.com/news/7824/winter-road-de-icers-like-salt-cause-3-billion-in-car-rust-damage-per-year"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
                >
                  $15.4 billion over five years fixing rust damage from road salt and de-icers
                </a>
                . The same salt goes down here.
              </p>
            </div>
          </Container>
        </section>

        <BookingBand
          phone={phone}
          email={email}
          area={area}
          title="Ready to get the winter out of your car?"
          text="Pick a package, pick a time, and you're booked. I'll confirm the same day."
        />

        {/* FAQ */}
        <section id="faq" className="site-glow scroll-mt-24">
          <Container className="grid gap-12 py-24 md:py-32 lg:grid-cols-[1fr_1.6fr]">
            <div>
              <SectionHeading label="FAQ" title="Common questions" />
              <p className="mt-6 max-w-[36ch] leading-relaxed text-[var(--text-muted)]">
                Something not covered here? Call{" "}
                <a href={tel} className="font-bold text-white underline underline-offset-4">
                  {phone}
                </a>
                .
              </p>
            </div>

            <div className="space-y-3">
              {faqs.map((f, i) => {
                const open = openFaq === i;
                return (
                  <div key={i} className="site-glass rounded-[18px]">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenFaq(open ? null : i)}
                      className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left text-[17px] font-bold"
                    >
                      {f.q}
                      <motion.span
                        animate={{ rotate: open ? 45 : 0 }}
                        transition={{ duration: 0.2 }}
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                          open ? "bg-[var(--estoril)] text-white" : "bg-white/10 text-white"
                        }`}
                      >
                        <Plus aria-hidden className="h-4 w-4" />
                      </motion.span>
                    </button>
                    <motion.div
                      initial={false}
                      animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <p className="max-w-[64ch] px-6 pb-6 leading-relaxed text-[var(--text-muted)]">
                        {f.a}
                        {/mobile|come to (me|you)/i.test(f.q) && (
                          <>
                            {" "}
                            <Link to="/book" className="font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                              Book mobile service
                            </Link>
                          </>
                        )}
                      </p>
                    </motion.div>
                  </div>
                );
              })}
            </div>
          </Container>
        </section>

        <SiteFooter phone={phone} email={email} area={area} />
      </div>
    </MotionConfig>
  );
}
