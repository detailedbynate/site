import { createFileRoute } from "@tanstack/react-router";

import {
  LandingPage,
  PriceCard,
  Section,
  TextLink,
  aboutTime,
  landingHead,
  landingSchema,
  nextSeasonSentence,
  originFrom,
  pkg,
  seasonSentence,
  travelSentence,
  type Catalog,
  type Faq,
} from "@/components/site/LandingPage";
import { getCatalog } from "@/lib/api/booking.functions";

// "interior car detailing sault ste marie": the Gold package, from the angle
// no local competitor owns in words, getting a Sault winter out of the cabin.

function faqsFor(c: Catalog | null): Faq[] {
  const gold = pkg(c, "gold");
  const fee = c?.travelFee ?? 25;
  const pet = c?.addOns.find((a) => /pet/i.test(a.name));
  const faqs: Faq[] = [];
  if (gold) {
    faqs.push({
      q: "How much is interior car detailing in Sault Ste. Marie?",
      a: `An interior-only detail (my ${gold.title} package) starts at $${gold.priceValue}. Mobile service adds $${fee}, and there's no deposit.`,
    });
  }
  faqs.push({
    q: "Can you get road salt and sand out of my car's interior?",
    a: "Yes, that's most of what I do after winter. Carpets, mats and seats get a deep clean so the salt and sand come out, not just the top layer.",
  });
  if (gold?.durationMinutes) {
    faqs.push({
      q: "How long does an interior detail take?",
      a: `The ${gold.title} package takes ${aboutTime(gold.durationMinutes)}. A very dirty vehicle can take longer, and I'll give you an honest timeframe up front.`,
    });
  }
  if (pet) {
    faqs.push({
      q: "Do you remove pet hair?",
      a: `Yes. ${pet.name} is an add-on for $${pet.price}, and you pick it when you book.`,
    });
  }
  faqs.push({
    q: "Do I need to do anything before an interior detail?",
    a: "Just take out your personal belongings. I handle everything else, from cup-holder gunk to dog hair embedded in the seats.",
  });
  return faqs;
}

export const Route = createFileRoute("/interior-detailing")({
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
    const gold = pkg(c, "gold");
    return landingHead({
      origin,
      path: "/interior-detailing",
      title: "Interior Car Detailing in Sault Ste. Marie | Detailed by Nate",
      description: `Get a Sault winter out of your car. Interior-only detailing by hand${
        gold ? ` from $${gold.priceValue}` : ""
      }: salt, sand and grime out of carpets, mats and seats. Mobile or drop-off, no deposit.`,
      schema: landingSchema({
        origin,
        path: "/interior-detailing",
        name: "Interior car detailing in Sault Ste. Marie",
        serviceType: "Interior car detailing",
        offers: gold ? [{ name: `${gold.title}: interior detail`, price: gold.priceValue }] : [],
        faqs: faqsFor(c),
      }),
    });
  },
  component: InteriorPage,
});

function InteriorPage() {
  const { catalog: c } = Route.useLoaderData();
  const fee = c?.travelFee ?? 25;
  const gold = pkg(c, "gold");
  const diamond = pkg(c, "diamond");
  const season = seasonSentence(c?.promo);
  const nextGold = gold ? nextSeasonSentence(gold, c?.promo) : null;
  const addOns = c?.addOns ?? [];

  return (
    <LandingPage
      path="/interior-detailing"
      title="Interior Car Detailing in Sault Ste. Marie"
      catalog={c}
      faqs={faqsFor(c)}
      intro={
        <>
          <p>
            Salt on the carpets, sand in the seat rails, slush dried onto everything. I'm Nate, and
            my interior detail gets a Sault winter out of your car, by hand.
          </p>
          {gold && (
            <p>
              An interior-only detail starts at ${gold.priceValue}
              {gold.durationMinutes ? ` and takes ${aboutTime(gold.durationMinutes)}` : ""}.
            </p>
          )}
        </>
      }
      aside={
        gold && (
          <PriceCard
            heading={`${gold.title} package: interior only`}
            rows={[
              { label: "At drop-off", price: `$${gold.priceValue}` },
              { label: "Mobile", detail: "At your home or work", price: `$${gold.priceValue + fee}` },
            ]}
            note="Starting prices. No deposit."
          />
        )
      }
    >
      <Section title="What does winter do to a car's interior?">
        <p>
          It packs road salt and sand into every carpet, mat and seam. Wet boots carry it in all
          season, and when it dries it leaves white salt marks and grit that a quick vacuum doesn't
          lift.
        </p>
        <p>
          The longer it sits, the harder it is to get out. That's why spring is when most people
          book an interior detail.
        </p>
      </Section>

      {gold && (
        <Section title={`What's in the ${gold.title} interior package?`}>
          {gold.description && <p>{gold.description}</p>}
          {gold.features.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {gold.features.map((f) => (
                <li key={f} className="site-glass rounded-[14px] px-4 py-3 text-[16px] text-white">
                  {f}
                </li>
              ))}
            </ul>
          )}
          <p>
            Every package starts with a pre-detail inspection so nothing gets missed. If the outside
            needs it too,{" "}
            {diamond ? (
              <>
                the {diamond.title} package does inside and out, starting at ${diamond.priceValue}.
              </>
            ) : (
              <>
                see all the packages on the <TextLink to="/" hash="packages">homepage</TextLink>.
              </>
            )}
          </p>
        </Section>
      )}

      <Section title="How much does interior car detailing cost?">
        {gold && (
          <p>
            An interior-only detail (my {gold.title} package) starts at ${gold.priceValue}.
          </p>
        )}
        <p>{travelSentence(fee)}</p>
        {nextGold && <p>{nextGold}</p>}
        {season && <p>{season}</p>}
        {addOns.length > 0 && (
          <p>
            Add-ons for the inside:{" "}
            {addOns.map((a, i) => (
              <span key={a.id}>
                {a.name.toLowerCase()} is ${a.price}
                {i < addOns.length - 1 ? ", " : "."}
              </span>
            ))}
          </p>
        )}
        <p>
          Every package, add-on and fee is on the{" "}
          <TextLink to="/prices">car detailing prices</TextLink> page.
        </p>
      </Section>

      <Section title="Can you do it at my house?">
        <p>
          Yes. With <TextLink to="/mobile-detailing">mobile car detailing</TextLink> I come to your
          home or work, as long as there's a water faucet and power outlet I can use.
        </p>
        <p>
          Or drop it off with me. Either way, see real jobs on the{" "}
          <TextLink to="/results">before-and-after results</TextLink> page.
        </p>
      </Section>
    </LandingPage>
  );
}
