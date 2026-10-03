import { Link } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { ArrowRight, Phone } from "lucide-react";
import type { ReactNode } from "react";

import { BookingBand, Container, SiteFooter, SiteNav } from "@/components/site/SiteChrome";
import type { getCatalog } from "@/lib/api/booking.functions";

// Shared by the service landing pages (/mobile-detailing, /interior-detailing,
// /prices): one layout, and price sentences built from the live catalog so a
// price edited in the admin is never contradicted by page copy.

export type Catalog = Awaited<ReturnType<typeof getCatalog>>;
export type Faq = { q: string; a: string };

const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

// ------------------------------------------------------------------ prices

export function pkg(catalog: Catalog | null | undefined, id: string) {
  return catalog?.services.find((s) => s.id === id) ?? null;
}

/** "about 2 hours", "about 1.5 hours", "about 45 minutes". */
export function aboutTime(minutes?: number | null): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `about ${minutes} minutes`;
  const h = Math.round((minutes / 60) * 2) / 2;
  return `about ${h} hour${h === 1 ? "" : "s"}`;
}

/** How each package is described in a sentence. */
const PACKAGE_PHRASE: Record<string, string> = {
  diamond: "A full interior and exterior detail",
  gold: "An interior-only detail",
  silver: "An exterior hand wash",
};

/** "A full interior and exterior detail (Diamond) starts at $100 and takes about 4 hours." */
export function priceSentence(s: Catalog["services"][number]): string {
  const what = PACKAGE_PHRASE[s.id] ?? `The ${s.title} package`;
  const named = PACKAGE_PHRASE[s.id] ? ` (my ${s.title} package)` : "";
  const time = aboutTime(s.durationMinutes);
  return `${what}${named} starts at $${s.priceValue}${time ? ` and takes ${time}` : ""}.`;
}

/** "For appointments in the 2027 season, it starts at $130." when a next-season price is set. */
export function nextSeasonSentence(
  s: Catalog["services"][number],
  promo: Catalog["promo"] | null | undefined,
): string | null {
  if (!promo?.enabled || s.nextPrice == null || s.nextPrice === s.priceValue) return null;
  return `For appointments in the ${promo.seasonLabel}, the ${s.title} package starts at $${s.nextPrice}.`;
}

export function travelSentence(travelFee: number): string {
  return travelFee > 0
    ? `Mobile service adds $${travelFee} for travel, and there's no deposit.`
    : "Mobile service costs nothing extra, and there's no deposit.";
}

export function seasonSentence(promo: Catalog["promo"] | null | undefined): string | null {
  if (!promo?.enabled) return null;
  return `Book a date in the ${promo.seasonLabel} and ${promo.percent}% comes off automatically.`;
}

/** The core packages in display order: Diamond, Gold, Silver, then any others. */
export function corePackages(catalog: Catalog | null | undefined) {
  const order = ["diamond", "gold", "silver"];
  return [...(catalog?.services ?? [])]
    .filter((s) => !s.id.startsWith("ceramic-"))
    .sort((a, b) => {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
}

// ------------------------------------------------------------------ schema

/** Service + FAQPage JSON-LD for one landing page. */
export function landingSchema({
  origin,
  path,
  name,
  serviceType,
  offers,
  faqs,
}: {
  origin: string;
  path: string;
  name: string;
  serviceType: string;
  offers: { name: string; price: number }[];
  faqs: Faq[];
}): string {
  const area = { "@type": "City", name: "Sault Ste. Marie, Ontario" };
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Service",
        "@id": `${origin}${path}#service`,
        name,
        serviceType,
        url: `${origin}${path}`,
        provider: { "@id": `${origin}/#business` },
        areaServed: area,
        ...(offers.length
          ? {
              offers: offers.map((o) => ({
                "@type": "Offer",
                name: o.name,
                priceSpecification: {
                  "@type": "PriceSpecification",
                  minPrice: o.price,
                  priceCurrency: "CAD",
                },
              })),
            }
          : {}),
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  });
}

/** Title, description, canonical, og/twitter and JSON-LD for a landing page. */
export function landingHead({
  origin,
  path,
  title,
  description,
  schema,
}: {
  origin: string;
  path: string;
  title: string;
  description: string;
  schema: string | null;
}) {
  const url = `${origin}${path}`;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: url }],
    scripts: schema ? [{ type: "application/ld+json", children: schema }] : [],
  };
}

/** The site origin from the root loader (Settings → Site URL, https). */
export function originFrom(matches: { loaderData?: unknown }[]): string {
  return (
    (matches[0]?.loaderData as { meta?: { siteUrl?: string } } | undefined)?.meta?.siteUrl ||
    "https://detailedbynate.com"
  );
}

// ------------------------------------------------------------------ layout

/** A text section: question-style heading, then a readable column of copy. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--line)] py-14 md:py-16">
      <h2 className="max-w-[24ch] text-[clamp(1.6rem,3.2vw,2.4rem)] leading-[1.05]">{title}</h2>
      <div className="mt-5 max-w-[68ch] space-y-4 text-[17px] leading-relaxed text-[var(--text-muted)]">
        {children}
      </div>
    </section>
  );
}

/** Inline link inside body copy. */
export function TextLink({
  to,
  hash,
  children,
}: {
  to: "/" | "/book" | "/results" | "/prices" | "/mobile-detailing" | "/interior-detailing";
  hash?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      hash={hash}
      className="font-medium text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white"
    >
      {children}
    </Link>
  );
}

const RELATED: { to: "/" | "/prices" | "/mobile-detailing" | "/interior-detailing"; label: string; text: string }[] = [
  { to: "/", label: "Car detailing in Sault Ste. Marie", text: "Every package, reviews and how booking works." },
  { to: "/prices", label: "Car detailing prices", text: "Every package, add-on and fee in one place." },
  { to: "/mobile-detailing", label: "Mobile car detailing", text: "I come to your home or work." },
  { to: "/interior-detailing", label: "Interior car detailing", text: "Winter salt and sand, out of the inside." },
];

export function LandingPage({
  path,
  title,
  intro,
  catalog,
  aside,
  faqs,
  children,
}: {
  path: "/prices" | "/mobile-detailing" | "/interior-detailing";
  title: string;
  intro: ReactNode;
  catalog: Catalog | null;
  /** Price card beside the intro. */
  aside?: ReactNode;
  faqs: Faq[];
  children: ReactNode;
}) {
  const business = catalog?.business;
  const phone = business?.phone ?? "";
  const email = business?.email ?? "";
  const area = business?.serviceArea ?? "Sault Ste. Marie area";

  return (
    <MotionConfig reducedMotion="user">
      <div className="site min-h-screen overflow-x-clip">
        <SiteNav phone={phone} />

        <header className="site-glow">
          <Container className="pb-14 pt-40 md:pb-20 md:pt-48">
            <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div>
                <h1 className="max-w-[16ch] text-[clamp(2.4rem,5.6vw,4.6rem)] font-extrabold leading-[0.98]">
                  {title}
                </h1>
                <div className="mt-6 max-w-[58ch] space-y-4 text-[18px] leading-relaxed text-[var(--text-muted)]">
                  {intro}
                </div>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link to="/book" className="site-btn">
                    Book your detail <ArrowRight aria-hidden className="h-4 w-4" />
                  </Link>
                  {phone && (
                    <a href={tel(phone)} className="site-btn-quiet">
                      <Phone aria-hidden className="h-4 w-4" /> {phone}
                    </a>
                  )}
                </div>
              </div>
              {aside}
            </div>
          </Container>
        </header>

        <Container>{children}</Container>

        {faqs.length > 0 && (
          <section className="site-glow border-t border-[var(--line)]">
            <Container className="py-20 md:py-24">
              <h2 className="text-[clamp(2rem,4vw,3rem)] leading-[1]">Common questions</h2>
              <div className="mt-10 grid gap-4 md:grid-cols-2">
                {faqs.map((f) => (
                  <div key={f.q} className="site-glass rounded-[18px] p-6">
                    <h3 className="text-[18px] font-bold leading-snug">{f.q}</h3>
                    <p className="mt-3 leading-relaxed text-[var(--text-muted)]">{f.a}</p>
                  </div>
                ))}
              </div>
            </Container>
          </section>
        )}

        <section className="border-t border-[var(--line)]">
          <Container className="py-16">
            <h2 className="text-[clamp(1.5rem,2.6vw,2rem)] leading-[1.1]">More from Detailed by Nate</h2>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {RELATED.filter((r) => r.to !== path).map((r) => (
                <li key={r.to}>
                  <Link
                    to={r.to}
                    className="site-card site-lift group relative block h-full rounded-[18px] p-6"
                  >
                    <span className="flex items-center justify-between gap-3 text-[17px] font-bold text-white">
                      {r.label}
                      <ArrowRight aria-hidden className="h-4 w-4 text-[var(--sky)]" />
                    </span>
                    <span className="mt-2 block text-[15px] text-[var(--text-muted)]">{r.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </section>

        <BookingBand phone={phone} email={email} area={area} />
        <SiteFooter phone={phone} email={email} area={area} />
      </div>
    </MotionConfig>
  );
}

/** The frosted price card beside a landing page's intro. */
export function PriceCard({
  heading,
  rows,
  note,
}: {
  heading: string;
  rows: { label: string; detail?: string; price: string }[];
  note?: string;
}) {
  return (
    <aside className="site-glass rounded-[22px] p-6">
      <p className="text-[15px] font-bold text-white">{heading}</p>
      <dl className="mt-4 divide-y divide-white/10">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4 py-3">
            <dt>
              <span className="block font-medium text-white">{r.label}</span>
              {r.detail && <span className="block text-[14px] text-[var(--text-muted)]">{r.detail}</span>}
            </dt>
            <dd className="site-display tnum shrink-0 text-[22px]">{r.price}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="mt-3 text-[14px] leading-relaxed text-[var(--text-muted)]">{note}</p>}
    </aside>
  );
}
