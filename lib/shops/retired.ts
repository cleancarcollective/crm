/**
 * Shops that have moved off this CRM onto their own system.
 *
 * Christchurch moved to its own CRM on 19 Nov 2026. Its rows still exist in
 * this database for a while, so anything that loops over every shop has to
 * skip it, and old customer links have to be sent on to the new system.
 *
 * Everything here is driven by env vars, so with none set this file changes
 * nothing:
 *
 *   RETIRED_SHOP_SLUGS           comma-separated slugs, e.g. "christchurch"
 *   RETIRED_SHOP_CRM_URL         base URL of the shop's new CRM
 *   RETIRED_SHOP_HANDOFF_SECRET  single-purpose secret the new CRM also holds,
 *                                used only to re-sign manage-booking links
 *
 * Once the retired shop's data is deleted from this database, remove the env
 * vars and this file's call sites.
 */

import { createHmac } from "crypto";

export function retiredShopSlugs(): Set<string> {
  return new Set(
    (process.env.RETIRED_SHOP_SLUGS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isRetiredShop(slug: string | null | undefined): boolean {
  return !!slug && retiredShopSlugs().has(slug.toLowerCase());
}

/** Drop retired shops from a "for every shop" list. */
export function withoutRetiredShops<T extends { slug: string }>(shops: T[]): T[] {
  const retired = retiredShopSlugs();
  if (retired.size === 0) return shops;
  return shops.filter((s) => !retired.has(s.slug.toLowerCase()));
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Build a manage-booking link on the retired shop's new CRM for the same
 * booking. Token format matches lib/auth/signedTokens.ts, signed with the
 * handoff secret instead of this CRM's own. Returns null when the handoff
 * isn't configured, so callers can fall back to a "we've moved" message.
 */
export function retiredShopManageBookingUrl(bookingId: string, shopId: string): string | null {
  const base = process.env.RETIRED_SHOP_CRM_URL?.replace(/\/$/, "");
  const secret = process.env.RETIRED_SHOP_HANDOFF_SECRET;
  if (!base || !secret) return null;

  const payload = { a: "manage_booking", r: bookingId, s: shopId, e: Date.now() + 60 * 60 * 1000 };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = createHmac("sha256", secret).update(payloadB64).digest("hex").slice(0, 32);
  return `${base}/manage-booking?token=${payloadB64}.${sig}`;
}
