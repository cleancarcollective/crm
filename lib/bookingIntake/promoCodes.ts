/**
 * Promo code engine for the booking intake.
 *
 * Codes are hard-coded for now (small set, fast iteration). When we have
 * more than ~5 active codes, move into a `promo_codes` DB table with
 * admin-edit UI.
 *
 * Each code declares:
 *   - which shop(s) it applies to
 *   - percent discount on this booking
 *   - credit grants (free future service rows added to customer_credits)
 *   - whether the customer-facing booking note should mention the credit
 */

export type PromoEffect = {
  /** Applied to booking.price_estimate (10% off => percentOff: 10). */
  percentOff: number;
  /** Credits granted on this booking. Each becomes a customer_credits row. */
  credits: Array<{
    serviceName: string;
    description: string;
    source: string;
  }>;
  /** Free-text note appended to booking.notes so staff + customer see the
   *  redemption record on the confirmation. */
  noteForBooking: string;
};

type PromoCodeDef = PromoEffect & {
  code: string;
  shopSlugs: string[] | null; // null = all shops
};

const PROMO_CODES: PromoCodeDef[] = [
  {
    // CCC5: 5% off the current booking, plus a free Deluxe Exterior Detail
    // on the customer's next visit. The 5% discount is applied client-side
    // by the Wellington booking app (matching how it handles CCC10/KEEKS),
    // so the server-side percentOff is 0 to avoid double-discounting. The
    // server's job for this code is purely (a) record the note on the
    // booking and (b) grant the customer_credits row for the free future
    // detail.
    code: "CCC5",
    shopSlugs: ["wellington"],
    percentOff: 0,
    credits: [
      {
        serviceName: "Deluxe Exterior Detail",
        description:
          "Free Deluxe Exterior Detail — granted with promo code CCC5. Redeem on a future booking.",
        source: "promo_code:CCC5",
      },
    ],
    noteForBooking:
      "Promo code CCC5 applied: 5% off this booking (already in the price), plus a free Deluxe Exterior Detail on your next visit.",
  },
];

/**
 * Look up a code (case-insensitive) for the given shop. Returns the
 * effects to apply, or null if the code is invalid / not allowed at this
 * shop.
 */
export function resolvePromoCode(
  rawCode: string | null | undefined,
  shopSlug: string
): PromoEffect | null {
  if (!rawCode) return null;
  const normalised = rawCode.trim().toUpperCase();
  if (!normalised) return null;

  const match = PROMO_CODES.find(
    (p) =>
      p.code === normalised &&
      (p.shopSlugs === null || p.shopSlugs.includes(shopSlug.toLowerCase()))
  );
  if (!match) return null;
  return {
    percentOff: match.percentOff,
    credits: match.credits,
    noteForBooking: match.noteForBooking,
  };
}

/**
 * Apply a percent discount to a price, rounded to 2 decimals. Returns the
 * discounted amount. If price is null/0, returns it unchanged.
 */
export function applyPercentOff(price: number | null, percentOff: number): number | null {
  if (price === null || price === undefined) return price;
  if (percentOff <= 0) return price;
  const discounted = price * (1 - percentOff / 100);
  return Math.round(discounted * 100) / 100;
}
