import { createFileRoute, Link } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";

import { BeforeAfter } from "@/components/BeforeAfter";
import { useBookingModal } from "@/components/booking/BookingModal";
import {
  BookingBand,
  Container,
  SiteFooter,
  SiteNav,
  Stars,
} from "@/components/site/SiteChrome";
import { getCatalog, getPublicGallery } from "@/lib/api/booking.functions";
import { getPublicTestimonials } from "@/lib/api/content.functions";

export const Route = createFileRoute("/results")({
  // Only the shop's own uploads (Admin → SEO & branding) appear here, so
  // nothing on this page is stock imagery presented as their own work.
  loader: async () => {
    try {
      const [gallery, catalog, reviews] = await Promise.all([
        getPublicGallery(),
        getCatalog(),
        getPublicTestimonials(),
      ]);
      return {
        gallery: gallery.pairs,
        business: catalog.business,
        review: reviews.testimonials[0] ?? null,
      };
    } catch {
      return { gallery: [], business: null, review: null };
    }
  },
  head: ({ loaderData }) => {
    const name = loaderData?.business?.name || "Detailed by Nate";
    const title = `Results — ${name} | Before & After Gallery`;
    const description = `Real before-and-after detailing results from ${name}.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: `Results — ${name}` },
        { property: "og:description", content: description },
      ],
    };
  },
  component: ResultsPage,
});

function ResultsPage() {
  const { gallery, business, review } = Route.useLoaderData();
  const booking = useBookingModal();
  const area = business?.serviceArea ?? "Sault Ste. Marie area";
  const shown = (gallery ?? [])
    .filter((g) => g.beforeUrl && g.afterUrl)
    .map((g) => ({
      id: g.id,
      label: g.label,
      detail: g.detail ?? "",
      before: g.beforeUrl as string,
      after: g.afterUrl as string,
      desc: g.description ?? "",
      package: g.packageLabel ?? "",
    }));

  return (
    <MotionConfig reducedMotion="user">
      <div className="site min-h-screen overflow-x-clip">
        <SiteNav phone={business?.phone} />

        <Container className="pt-40 md:pt-48">
          <h1 className="text-[clamp(2.2rem,5.2vw,4.4rem)] font-extrabold leading-[0.98]">Results</h1>
          <p className="mt-5 max-w-[56ch] text-[17px] leading-relaxed text-[var(--text-muted)]">
            Real jobs from around the {area}. Drag the handle on each photo to compare before and
            after.
          </p>
        </Container>

        <Container className="pb-24 pt-12">
          {shown.length === 0 ? (
            <div className="max-w-[560px] border-t border-[var(--line)] pt-10">
              <h2 className="text-[26px] font-bold">Photos are on the way</h2>
              <p className="mt-3 leading-relaxed text-[var(--text-muted)]">
                Before-and-after shots from recent jobs will appear here as they're added. In the
                meantime, the packages list exactly what each detail includes.
              </p>
              <Link to="/" hash="packages" className="site-btn-quiet mt-7">
                See packages
              </Link>
            </div>
          ) : (
            <ul className="space-y-16 md:space-y-24">
              {shown.map((r) => (
                <li
                  key={r.id}
                  className="grid items-center gap-8 border-t border-[var(--line)] pt-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-14"
                >
                  <BeforeAfter before={r.before} after={r.after} label={r.label} />
                  <div>
                    {r.package && (
                      <p className="inline-block rounded-[4px] border border-[var(--line)] px-2 py-1 text-[13px] text-[var(--ice)]">
                        {r.package}
                      </p>
                    )}
                    <h2 className="mt-4 text-[clamp(1.8rem,3.4vw,2.6rem)] font-bold leading-[1.02]">
                      {r.label}
                    </h2>
                    {r.detail && <p className="mt-2 text-[17px] text-[var(--ice)]">{r.detail}</p>}
                    {r.desc && (
                      <p className="mt-5 max-w-[52ch] leading-relaxed text-[var(--text-muted)]">{r.desc}</p>
                    )}
                    <button type="button" onClick={() => booking.open()} className="site-btn mt-7">
                      Book a detail
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Container>

        {/* A real review from the Reviews & FAQ admin, never a made-up one. */}
        {review && (
          <section className="bg-[var(--frost)] text-[var(--ink)]">
            <Container className="py-20 md:py-24">
              <figure className="max-w-[46ch]">
                <Stars count={review.rating} className="text-[#d98f12]" />
                <blockquote className="mt-5 text-[clamp(1.4rem,2.6vw,2rem)] font-semibold leading-snug">
                  “{review.text}”
                </blockquote>
                <figcaption className="mt-6 text-[15px]">
                  <span className="font-semibold">{review.name}</span>
                  {review.car && <span className="text-[#4a5d78]">, {review.car}</span>}
                </figcaption>
              </figure>
            </Container>
          </section>
        )}

        <BookingBand phone={business?.phone} email={business?.email} area={area} />
        <SiteFooter phone={business?.phone} email={business?.email} area={area} />
      </div>
    </MotionConfig>
  );
}
