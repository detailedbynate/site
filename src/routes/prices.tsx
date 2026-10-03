import { createFileRoute } from "@tanstack/react-router";

import {
  LandingPage,
  PriceCard,
  Section,
  TextLink,
  aboutTime,
  corePackages,
  landingHead,
  landingSchema,
  nextSeasonSentence,
  originFrom,
  pkg,
  priceSentence,
  seasonSentence,
  travelSentence,
  type Catalog,
  type Faq,
} from "@/components/site/LandingPage";
import { getCatalog } from "@/lib/api/booking.functions";

// "car detailing prices sault ste marie": every price written as a sentence,
// which is what AI answers quote. All figures come from the live catalog.

function costAnswer(c: Catalog | null): string | null {
  const d = pkg(c, "diamond");
  const g = pkg(c, "gold");
  const s = pkg(c, "silver");
  const parts = [
    d && `a full interior and exterior detail starts at $${d.priceValue}`,
    g && `an interior-only detail at $${g.priceValue}`,
    s && `an exterior hand wash at $${s.priceValue}`,
  ].filter(Boolean) as string[];
  if (!parts.length) return null;
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]!;
  return `With me, ${list}.`;
}

function faqsFor(c: Catalog | null): Faq[] {
  const fee = c?.travelFee ?? 25;
  const faqs: Faq[] = [];
  const cost = costAnswer(c);
  if (cost) {
    faqs.push({
      q: "How much does car detailing cost in Sault Ste. Marie?",
      a: `${cost} ${travelSentence(fee)}`,
    });
  }
  faqs.push(
    {
      q: "Why are the prices \"starting at\"?",
      a: "A minivan after a hockey season isn't the same job as a sedan that gets washed every month. The booking page shows your total before you confirm.",
    },
    {
      q: "Do I have to pay a deposit?",
      a: "No. Booking is free, and there's no deposit to hold your spot.",
    },
  );
  const season = seasonSentence(c?.promo);
  if (season && c?.promo) {
    faqs.push({
      q: `Is there a discount for booking the ${c.promo.seasonLabel}?`,
      a: `Yes. ${season}`,
    });
  }
  faqs.push({
    q: "Is car detailing worth the price?",
    a: "If your car has been through a Sault winter, usually yes. A detail gets out the salt and sand a quick wash leaves behind, and it saves you most of a day doing it yourself.",
  });
  return faqs;
}

export const Route = createFileRoute("/prices")({
  loader: async () => {
    try {
      return { catalog: await getCatalog() };
    } catch {
      return { catalog: null };
    }
  },
  head: ({ loaderData, matches }) => {
    const c = loaderData?.catalog ?? null;
    const origin = originFrom(matches);
    const cost = costAnswer(c);
    return landingHead({
      origin,
      path: "/prices",
      title: "Car Detailing Prices in Sault Ste. Marie | Detailed by Nate",
      description: `${cost ?? "Car detailing prices in Sault Ste. Marie."} Mobile service adds $${
        c?.travelFee ?? 25
      }. No deposit. Every package and add-on price in one place.`,
      schema: landingSchema({
        origin,
        path: "/prices",
        name: "Car detailing in Sault Ste. Marie",
        serviceType: "Car detailing",
        offers: corePackages(c).map((s) => ({
          name: s.subtitle ? `${s.title}: ${s.subtitle}` : s.title,
          price: s.priceValue,
        })),
        faqs: faqsFor(c),
      }),
    });
  },
  component: PricesPage,
});

function PricesPage() {
  const { catalog: c } = Route.useLoaderData();
  const fee = c?.travelFee ?? 25;
  const packages = corePackages(c);
  const cost = costAnswer(c);
  const season = seasonSentence(c?.promo);
  const nextSeason = packages.map((s) => nextSeasonSentence(s, c?.promo)).filter(Boolean) as string[];
  const addOns = c?.addOns ?? [];
  const ceramic = c?.ceramicMode ?? "hidden";
  const coatings = (c?.services ?? []).filter((s) => s.id.startsWith("ceramic-"));

  return (
    <LandingPage
      path="/prices"
      title="Car Detailing Prices in Sault Ste. Marie"
      catalog={c}
      faqs={faqsFor(c)}
      intro={
        <>
          {cost && <p>{cost}</p>}
          <p>{travelSentence(fee)} Every job is done by hand, by me.</p>
        </>
      }
      aside={
        packages.length > 0 && (
          <PriceCard
            heading="Starting prices"
            rows={packages.map((s) => ({
              label: s.title,
              detail: [s.subtitle, aboutTime(s.durationMinutes)].filter(Boolean).join(", "),
              price: `$${s.priceValue}`,
            }))}
            note={fee > 0 ? `Mobile adds $${fee}. No deposit.` : "No deposit."}
          />
        )
      }
    >
      <Section title="How much is each detailing package?">
        {packages.map((s) => (
          <p key={s.id}>{priceSentence(s)}</p>
        ))}
        {nextSeason.map((t) => (
          <p key={t}>{t}</p>
        ))}
        <p>
          If the inside took the beating, book{" "}
          {pkg(c, "gold") ? <TextLink to="/interior-detailing">interior car detailing</TextLink> : "an interior detail"}
          . If it's both, which it usually is after winter, book the full detail.
        </p>
      </Section>

      <Section title="How much is mobile detailing?">
        <p>{travelSentence(fee)}</p>
        <p>
          With <TextLink to="/mobile-detailing">mobile car detailing</TextLink> I come to your home
          or work anywhere in Sault Ste. Marie. Or drop it off with me and skip the travel fee.
        </p>
      </Section>

      {addOns.length > 0 && (
        <Section title="How much are add-ons?">
          {addOns.map((a) => (
            <p key={a.id}>
              {a.name} is ${a.price} extra{a.detail ? ` (${a.detail.replace(/\.$/, "").replace(/^[A-Z](?=[a-z])/, (m) => m.toLowerCase())})` : ""}.
            </p>
          ))}
          <p>You pick add-ons when you book, and the total updates before you confirm.</p>
        </Section>
      )}

      {(season || ceramic !== "hidden") && (
        <Section title="Are there discounts or new services coming?">
          {season && <p>{season}</p>}
          {ceramic === "open" &&
            coatings.map((s) => (
              <p key={s.id}>
                {s.title} ceramic coating starts at ${s.priceValue}. It's drop-off only.
              </p>
            ))}
          {ceramic === "soon" && (
            <p>
              Ceramic coating is coming for the 2027 season, and prices will be posted here when
              reservations open. It's drop-off only.
            </p>
          )}
        </Section>
      )}

      <Section title="How do I get an exact price?">
        <p>
          Pick a package and any add-ons on the <TextLink to="/book">booking page</TextLink> and it
          shows your total before you confirm. Not sure which package fits your car? Get in touch
          and I'll recommend the right one.
        </p>
        <p>
          You can also see every package on the{" "}
          <TextLink to="/">car detailing in Sault Ste. Marie</TextLink> homepage.
        </p>
      </Section>
    </LandingPage>
  );
}
