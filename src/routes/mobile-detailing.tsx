import { createFileRoute } from "@tanstack/react-router";

import {
  LandingPage,
  PriceCard,
  Section,
  TextLink,
  corePackages,
  landingHead,
  landingSchema,
  originFrom,
  pkg,
  priceSentence,
  seasonSentence,
  travelSentence,
  type Catalog,
  type Faq,
} from "@/components/site/LandingPage";
import { getCatalog } from "@/lib/api/booking.functions";

// "mobile car detailing sault ste marie": the at-your-place service, with
// what Nate needs on site and what it costs, as plain sentences.

function faqsFor(c: Catalog | null): Faq[] {
  const fee = c?.travelFee ?? 25;
  const faqs: Faq[] = [
    {
      q: "Do you come to my house for car detailing in Sault Ste. Marie?",
      a: `Yes. I come to your home or work anywhere in Sault Ste. Marie, and it adds $${fee} to the package price.`,
    },
    {
      q: "What do I need for a mobile detail?",
      a: "A water faucet and a power outlet I can use, and room to work around the car. Take out your personal belongings and I handle everything else.",
    },
    {
      q: "What if I don't have water or power where the car is parked?",
      a: `Then drop it off with me instead. The packages are the same, without the $${fee} travel fee.`,
    },
    {
      q: "How do I book a mobile detail?",
      a: "Pick a package on the booking page, choose Mobile and add your address. I'll confirm the same day.",
    },
  ];
  if (c?.ceramicMode !== "hidden") {
    faqs.push({
      q: "Can ceramic coating be done at my house?",
      a: "No. A coating needs a clean, covered space to set, so ceramic coating is drop-off only.",
    });
  }
  return faqs;
}

export const Route = createFileRoute("/mobile-detailing")({
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
    const fee = c?.travelFee ?? 25;
    return landingHead({
      origin,
      path: "/mobile-detailing",
      title: "Mobile Car Detailing in Sault Ste. Marie | Detailed by Nate",
      description: `I come to your home or work in Sault Ste. Marie and detail your car by hand. Mobile service adds $${fee} to any package, no deposit. Book online in about a minute.`,
      schema: landingSchema({
        origin,
        path: "/mobile-detailing",
        name: "Mobile car detailing in Sault Ste. Marie",
        serviceType: "Mobile car detailing",
        offers: corePackages(c).map((s) => ({
          name: `Mobile ${s.title} detail`,
          price: s.priceValue + fee,
        })),
        faqs: faqsFor(c),
      }),
    });
  },
  component: MobilePage,
});

function MobilePage() {
  const { catalog: c } = Route.useLoaderData();
  const fee = c?.travelFee ?? 25;
  const packages = corePackages(c);
  const diamond = pkg(c, "diamond");
  const season = seasonSentence(c?.promo);

  return (
    <LandingPage
      path="/mobile-detailing"
      title="Mobile Car Detailing in Sault Ste. Marie"
      catalog={c}
      faqs={faqsFor(c)}
      intro={
        <>
          <p>
            I come to your home or work and detail your car by hand, right where it's parked.
            Mobile service adds ${fee} to any package, and there's no deposit.
          </p>
          {diamond && (
            <p>
              A full interior and exterior detail at your place starts at ${diamond.priceValue + fee}{" "}
              (${diamond.priceValue} for the package plus ${fee} for travel).
            </p>
          )}
        </>
      }
      aside={
        packages.length > 0 && (
          <PriceCard
            heading="Mobile prices"
            rows={packages.map((s) => ({
              label: s.title,
              detail: s.subtitle,
              price: `$${s.priceValue + fee}`,
            }))}
            note={`Package price plus $${fee} travel. Starting prices; bigger or dirtier vehicles can take longer.`}
          />
        )
      }
    >
      <Section title="How does mobile detailing work?">
        <p>
          You book online, pick Mobile and add your address. I show up at the time you picked, do
          the whole detail on site, and you get your car back without going anywhere.
        </p>
        <p>
          It's the same work as a drop-off detail, done by hand. Every package starts with a
          pre-detail inspection so nothing gets missed.
        </p>
      </Section>

      <Section title="What do I need on site?">
        <p>
          A water faucet and a power outlet I can use, and enough room to get around the car. A
          driveway or a work parking lot is usually fine.
        </p>
        <p>
          If that doesn't work where you are, drop it off with me instead. You choose mobile or
          drop-off when you book.
        </p>
      </Section>

      <Section title="How much does mobile car detailing cost?">
        {packages.map((s) => (
          <p key={s.id}>{priceSentence(s)}</p>
        ))}
        <p>{travelSentence(fee)}</p>
        {season && <p>{season}</p>}
        <p>
          The <TextLink to="/book">booking page</TextLink> shows your total before you confirm, and
          every price is on the <TextLink to="/prices">car detailing prices</TextLink> page.
        </p>
      </Section>

      <Section title="Mobile or drop-off: which should I pick?">
        <p>
          Pick mobile if you'd rather not move the car, or you want it done while you work. Pick
          drop-off if there's no faucet or outlet where it's parked, or you'd rather skip the $
          {fee} travel fee.
        </p>
        <p>
          If the inside took the worst of winter, my{" "}
          <TextLink to="/interior-detailing">interior car detailing</TextLink> works either way. All
          the packages are on the <TextLink to="/" hash="packages">homepage</TextLink>.
        </p>
      </Section>
    </LandingPage>
  );
}
