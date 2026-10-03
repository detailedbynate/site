// Next-season reservations: dates inside an upcoming season can be booked
// now, and get a percentage off automatically. Pure helpers, shared by the
// server (which decides the price) and the browser (which only previews it).

export interface Promo {
  enabled: boolean;
  percent: number;
  /** YYYY-MM-DD, inclusive. */
  seasonStart: string;
  seasonEnd: string;
  /** How the season is named on the site, e.g. "2027 season". */
  seasonLabel: string;
  /** Top banner wording, placeholders already filled in. */
  barText: string;
  /** Homepage popup wording, placeholders already filled in. */
  popupText: string;
}

type PromoSettings = {
  promoEnabled: boolean;
  promoPercent: number;
  promoSeasonStart: string;
  promoSeasonEnd: string;
  promoSeasonLabel: string;
  promoBarText: string;
  promoPopupText: string;
};

/**
 * The public view of the promotion. `{percent}` and `{season}` in the owner's
 * wording are filled here, so changing the discount never leaves a stale
 * number in a sentence.
 */
export function promoFromSettings(s: PromoSettings): Promo {
  const fill = (text: string) =>
    text.replaceAll("{percent}", String(s.promoPercent)).replaceAll("{season}", s.promoSeasonLabel);
  return {
    enabled:
      s.promoEnabled &&
      s.promoPercent > 0 &&
      Boolean(s.promoSeasonStart) &&
      Boolean(s.promoSeasonEnd) &&
      s.promoSeasonEnd >= s.promoSeasonStart,
    percent: s.promoPercent,
    seasonStart: s.promoSeasonStart,
    seasonEnd: s.promoSeasonEnd,
    seasonLabel: s.promoSeasonLabel,
    barText: fill(s.promoBarText),
    popupText: fill(s.promoPopupText),
  };
}

/** Whether a booking date falls inside the promoted season. */
export function isSeasonDate(
  promo: Promo | null | undefined,
  date: string | null | undefined,
): boolean {
  return Boolean(promo?.enabled && date && date >= promo.seasonStart && date <= promo.seasonEnd);
}

/** Whole dollars, like every other price on the site. */
export function seasonDiscount(promo: Promo, price: number): number {
  return Math.round((price * promo.percent) / 100);
}
