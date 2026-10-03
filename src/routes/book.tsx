import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { Check } from "lucide-react";

import { BookingWizard } from "@/components/booking/BookingWizard";
import { Container, SiteFooter, SiteNav } from "@/components/site/SiteChrome";
import { getCatalog } from "@/lib/api/booking.functions";

export const Route = createFileRoute("/book")({
  loader: async () => {
    try {
      return { business: (await getCatalog()).business };
    } catch {
      return { business: null };
    }
  },
  // Built from the loader, not hardcoded: the business name and service area
  // are editable in Settings, and a title that still said "Detailed by Nate,
  // Sault Ste. Marie" after either changed would be wrong in the one place
  // customers and crawlers actually read.
  head: ({ loaderData, matches }) => {
    const name = loaderData?.business?.name || "Detailed by Nate";
    const title = `Book Car Detailing in Sault Ste. Marie | ${name}`;
    const description =
      "Book a hand car detail in Sault Ste. Marie in about a minute. Pick a package, mobile or drop-off, and a time. No deposit, confirmed the same day.";
    const origin =
      (matches[0]?.loaderData as { meta?: { siteUrl?: string } } | undefined)?.meta?.siteUrl ||
      "https://detailedbynate.com";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: `${origin}/book` },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href: `${origin}/book` }],
    };
  },
  component: BookPage,
});

const linkCls = "underline decoration-white/30 underline-offset-4 hover:decoration-white";

const steps: ReactNode[] = [
  <>
    Choose your package (
    <Link to="/" hash="packages" className={linkCls}>
      Diamond, Gold, or Silver
    </Link>
    )
  </>,
  "Pick a date and time that works for you",
  "Drop off or request mobile service",
  "Drive away showroom-ready",
];

function BookPage() {
  const { business } = Route.useLoaderData();
  const area = business?.serviceArea ?? "Sault Ste. Marie area";
  const phone = business?.phone ?? "(555) 123-4567";
  const email = business?.email ?? "book@detailedbynate.com";
  const notes: ReactNode[] = [
    "All packages include a pre-detail inspection",
    `Mobile service available across the ${area}`,
    <>
      <Link to="/" hash="ceramic" className={linkCls}>
        Ceramic coatings
      </Link>{" "}
      require a 24-hour cure window
    </>,
    "Gift cards available — ask when booking",
  ];

  return (
    <MotionConfig reducedMotion="user">
      <div className="site min-h-screen overflow-x-clip">
        <SiteNav phone={phone} />

        <Container className="pb-24 pt-40 md:pt-48">
          <h1 className="text-[clamp(2.2rem,5.2vw,4.4rem)] font-extrabold leading-[0.98]">
            Book a detail
          </h1>
          <p className="mt-5 max-w-[58ch] text-[17px] leading-relaxed text-[var(--text-muted)]">
            Choose a package, pick a time, and you're booked. Not sure{" "}
            <Link to="/" hash="packages" className="underline decoration-white/30 underline-offset-4 hover:decoration-white">
              which package fits your car
            </Link>
            ? Get in touch and I'll recommend the right one, with an honest timeframe.
          </p>

          <div className="mt-12 grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* Live booking wizard — the same component the Book button opens. */}
            <div id="booking-widget" className="site-wizard scroll-mt-24">
              <BookingWizard />
            </div>

            <aside className="space-y-9 lg:sticky lg:top-24">
              <div>
                <h2 className="text-[19px] font-bold">How it works</h2>
                <ol className="mt-4 space-y-3.5">
                  {steps.map((s, i) => (
                    <li key={i} className="flex gap-3.5 text-[15px] leading-snug">
                      <span className="site-wordmark tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-[13px] text-[var(--sky)]">
                        {i + 1}
                      </span>
                      <span className="pt-1">{s}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="border-t border-[var(--line)] pt-8">
                <h2 className="text-[19px] font-bold">Good to know</h2>
                <ul className="mt-4 space-y-3">
                  {notes.map((n, i) => (
                    <li key={i} className="flex gap-2.5 text-[15px] leading-snug text-[var(--text-muted)]">
                      <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sky)]" />
                      {n}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-[var(--line)] pt-8">
                <h2 className="text-[19px] font-bold">Questions first?</h2>
                <dl className="mt-4 space-y-3.5 text-[15px]">
                  <div>
                    <dt className="text-[13px] text-[var(--text-muted)]">Phone</dt>
                    <dd>
                      <a
                        href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                        className="font-semibold underline-offset-4 hover:underline"
                      >
                        {phone}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[13px] text-[var(--text-muted)]">Email</dt>
                    <dd>
                      <a href={`mailto:${email}`} className="font-semibold underline-offset-4 hover:underline">
                        {email}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[13px] text-[var(--text-muted)]">Hours</dt>
                    <dd className="font-semibold">Mon–Sat, 8am–6pm</dd>
                  </div>
                </dl>
              </div>
            </aside>
          </div>
        </Container>

        <SiteFooter phone={phone} email={email} area={area} />
      </div>
    </MotionConfig>
  );
}
