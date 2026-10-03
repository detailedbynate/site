// Shared, client+server safe. No secrets.
//
// These are the SEED defaults. The live catalog is stored in the database
// (see db.server.ts) so it can be edited from /admin/services — but the
// shapes and the pricing maths below are shared by client and server, so
// the total a customer is quoted and the total the server charges can
// never drift apart. The server always recomputes; the client's numbers
// are display-only.

export type ServiceId = string;
export type AddOnId = string;
export type LocationChoice = "mobile" | "shop";

export interface ServiceDef {
  id: ServiceId;
  title: string;
  subtitle: string;
  priceValue: number;
  durationMinutes: number;
  features?: string[];
  description?: string;
}

export interface AddOnDef {
  id: AddOnId;
  name: string;
  detail: string;
  price: number;
  durationMinutes: number;
}

export const DEFAULT_SERVICES: ServiceDef[] = [
  {
    id: "silver",
    title: "Silver",
    subtitle: "Exterior",
    priceValue: 149,
    durationMinutes: 90,
    features: ["Foam pre-soak", "Two-bucket hand wash", "Wheels + tires", "Spray sealant"],
    description:
      "A proper hand wash that protects your paint. Foam pre-soak, two-bucket method, wheels degreased, and a sealant for that deep wet shine.",
  },
  {
    id: "gold",
    title: "Gold",
    subtitle: "Interior",
    priceValue: 199,
    durationMinutes: 120,
    features: ["Steam extraction", "Leather condition", "Vents + crevices", "Glass interior"],
    description:
      "Cabin restored to factory-fresh. Steam extraction on carpets and seats, leather conditioned, every crevice, vent and stitch line touched by hand.",
  },
  {
    id: "diamond",
    title: "Diamond",
    subtitle: "Interior & Exterior",
    priceValue: 399,
    durationMinutes: 240,
    features: [
      "Full exterior decon + wax",
      "Complete interior deep clean",
      "Tire & trim dressing",
      "Glass + jambs",
    ],
    description:
      "The full obsession. Two-bucket exterior decon wash, clay bar and seal, plus a complete interior reset — steam, leather conditioning, and every vent detailed.",
  },
];

export const DEFAULT_ADD_ONS: AddOnDef[] = [
  {
    id: "pet",
    name: "Pet hair removal",
    detail: "Heavy shedding, seats and carpet",
    price: 45,
    durationMinutes: 40,
  },
  {
    id: "engine",
    name: "Engine bay cleanse",
    detail: "Degrease, rinse, dress",
    price: 39,
    durationMinutes: 30,
  },
  {
    id: "ozone",
    name: "Odor / ozone treatment",
    detail: "Smoke and mildew neutralizing",
    price: 59,
    durationMinutes: 45,
  },
  {
    id: "headlight",
    name: "Headlight restoration",
    detail: "Sanded, polished, UV sealed",
    price: 69,
    durationMinutes: 50,
  },
  {
    id: "leather",
    name: "Leather condition",
    detail: "pH cleanse + conditioner",
    price: 35,
    durationMinutes: 25,
  },
  {
    id: "wax",
    name: "Hand carnauba wax",
    detail: "3-month deep gloss layer",
    price: 49,
    durationMinutes: 40,
  },
];

export const DEFAULT_TRAVEL_FEE = 25;

// --------------------------------------------------------------------------
// Quote maths — one implementation, used by the wizard's running total and
// by the server when it writes the booking.
// --------------------------------------------------------------------------

export interface Quote {
  price: number;
  durationMinutes: number;
}

export function quote(input: {
  service: Pick<ServiceDef, "priceValue" | "durationMinutes"> | undefined;
  addOns: Pick<AddOnDef, "price" | "durationMinutes">[];
  location: LocationChoice | null;
  travelFee: number;
}): Quote {
  const { service, addOns, location, travelFee } = input;
  return {
    price:
      (service?.priceValue ?? 0) +
      addOns.reduce((sum, a) => sum + a.price, 0) +
      (location === "mobile" ? travelFee : 0),
    durationMinutes:
      (service?.durationMinutes ?? 0) +
      addOns.reduce((sum, a) => sum + a.durationMinutes, 0),
  };
}

/** Apply a coupon to a subtotal. Never returns below zero. */
export function applyDiscount(
  subtotal: number,
  coupon: { type: "percent" | "fixed"; value: number } | null,
): number {
  if (!coupon) return subtotal;
  const off = coupon.type === "percent" ? (subtotal * coupon.value) / 100 : coupon.value;
  return Math.max(0, Math.round(subtotal - off));
}

export const VEHICLE_COLORS = [
  "Black",
  "White",
  "Silver",
  "Gray",
  "Blue",
  "Red",
  "Green",
  "Other",
] as const;

/**
 * Ceramic coating tiers, added for the 2027 season. Typical market pricing as
 * a starting point — the owner edits price, time and wording under Services.
 * The ids are what mark a service as a coating (see isCoatingService), so the
 * homepage section and the season-only rule find them.
 */
export const CERAMIC_SERVICES: (ServiceDef & { features: string[]; description: string })[] = [
  {
    id: "ceramic-1yr",
    title: "Ceramic 1-Year",
    subtitle: "1 year of protection",
    priceValue: 349,
    durationMinutes: 300,
    description:
      "Entry-level ceramic protection. A full decontamination wash and clay, then a 1-year coating on the paint and wheel faces for gloss and easy cleaning.",
    features: ["Decon wash + clay", "1-year paint coating", "Wheel faces coated", "Water-beading finish"],
  },
  {
    id: "ceramic-3yr",
    title: "Ceramic 3-Year",
    subtitle: "3 years of protection",
    priceValue: 799,
    durationMinutes: 450,
    description:
      "The sweet spot. A one-step polish removes light swirls and boosts gloss before a 3-year coating goes on the paint, wheels and glass.",
    features: ["Decon wash + clay", "One-step polish", "3-year paint coating", "Wheels + glass coated"],
  },
  {
    id: "ceramic-5yr",
    title: "Ceramic 5-Year",
    subtitle: "5 years of protection",
    priceValue: 1199,
    durationMinutes: 540,
    description:
      "Maximum protection. Two-step paint correction removes swirls and light scratches, then a 5-year coating goes on the paint, wheels, glass and trim.",
    features: ["Two-step paint correction", "5-year paint coating", "Wheels + glass coated", "Plastic trim coated"],
  },
];

/** Ceramic coating tiers are the services whose id starts with "ceramic-". */
export function isCoatingService(id: string | null | undefined): boolean {
  return Boolean(id && id.startsWith("ceramic-"));
}
