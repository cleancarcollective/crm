/**
 * Upsell offers data layer: create offers + items, load them for the
 * portal, and apply an accepted item to its booking (append the add-on,
 * bump the price). Per the agreed design, accepting is instant and does
 * NOT auto-extend the schedule - staff get flagged with the added time.
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getPortalContacts } from "@/lib/portal/session";

export type UpsellItemRecord = {
  id: string;
  offer_id: string;
  addon_id: string | null;
  title: string;
  description: string | null;
  price_cents: number;
  duration_min: number;
  photo_paths: string[];
  captured_at: string | null;
  status: "pending" | "accepted" | "declined";
  responded_at: string | null;
  added_to_booking_at: string | null;
};

export type UpsellOfferRecord = {
  id: string;
  booking_id: string | null;
  contact_id: string;
  shop_id: string;
  created_by: string | null;
  status: "sent" | "viewed" | "closed";
  sent_via: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  items: UpsellItemRecord[];
};

export type NewUpsellItem = {
  addon_id: string | null;
  title: string;
  description: string | null;
  price_cents: number;
  duration_min: number;
  photo_paths: string[];
  captured_at: string | null;
};

const ITEM_COLS =
  "id, offer_id, addon_id, title, description, price_cents, duration_min, photo_paths, captured_at, status, responded_at, added_to_booking_at";
const OFFER_COLS =
  "id, booking_id, contact_id, shop_id, created_by, status, sent_via, sent_at, viewed_at";

/** Create an offer with its items. Returns the full offer or null. */
export async function createOffer(args: {
  bookingId: string;
  contactId: string;
  shopId: string;
  createdBy: string | null;
  items: NewUpsellItem[];
}): Promise<UpsellOfferRecord | null> {
  const supabase = getSupabaseAdminClient();
  const { data: offer, error } = await supabase
    .from("upsell_offers")
    .insert({
      booking_id: args.bookingId,
      contact_id: args.contactId,
      shop_id: args.shopId,
      created_by: args.createdBy,
      status: "sent",
    })
    .select(OFFER_COLS)
    .single();
  if (error || !offer) {
    console.error("createOffer: offer insert failed", error);
    return null;
  }

  const rows = args.items.map((it) => ({ ...it, offer_id: offer.id }));
  const { data: items, error: itemErr } = await supabase
    .from("upsell_items")
    .insert(rows)
    .select(ITEM_COLS);
  if (itemErr) {
    console.error("createOffer: items insert failed", itemErr);
    // Roll back the offer so we never leave an empty shell.
    await supabase.from("upsell_offers").delete().eq("id", offer.id);
    return null;
  }

  return { ...(offer as UpsellOfferRecord), items: (items ?? []) as UpsellItemRecord[] };
}

async function loadOffer(offerId: string): Promise<UpsellOfferRecord | null> {
  const supabase = getSupabaseAdminClient();
  const { data: offer } = await supabase.from("upsell_offers").select(OFFER_COLS).eq("id", offerId).maybeSingle();
  if (!offer) return null;
  const { data: items } = await supabase
    .from("upsell_items")
    .select(ITEM_COLS)
    .eq("offer_id", offerId)
    .order("created_at", { ascending: true });
  return { ...(offer as UpsellOfferRecord), items: (items ?? []) as UpsellItemRecord[] };
}

/**
 * Load an offer for a portal session, verifying the offer's contact is
 * one of the session email's contacts. Marks the offer viewed on first
 * open. Returns null if not found or not owned by this email.
 */
export async function getOfferForEmail(offerId: string, email: string): Promise<UpsellOfferRecord | null> {
  const offer = await loadOffer(offerId);
  if (!offer) return null;
  const contacts = await getPortalContacts(email);
  if (!contacts.some((c) => c.id === offer.contact_id)) return null;

  if (offer.status === "sent") {
    const supabase = getSupabaseAdminClient();
    await supabase
      .from("upsell_offers")
      .update({ status: "viewed", viewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", offer.id);
    offer.status = "viewed";
  }
  return offer;
}

export type RespondResult =
  | { ok: true; changed: boolean; item: UpsellItemRecord; offer: UpsellOfferRecord }
  | { ok: false; error: string; status?: number };

/**
 * Accept or decline one item. Ownership is verified against the session
 * email. Accepting appends the add-on to the booking (idempotent: a
 * second accept is a no-op). Returns the updated item + offer.
 */
export async function respondToItem(args: {
  offerId: string;
  itemId: string;
  action: "accept" | "decline";
  email: string;
}): Promise<RespondResult> {
  const offer = await getOfferForEmail(args.offerId, args.email);
  if (!offer) return { ok: false, error: "Offer not found", status: 404 };
  const item = offer.items.find((i) => i.id === args.itemId);
  if (!item) return { ok: false, error: "Item not found", status: 404 };

  // Idempotent: already-resolved items just return current state.
  if (item.status !== "pending") return { ok: true, changed: false, item, offer };

  const supabase = getSupabaseAdminClient();
  const now = new Date().toISOString();
  let changed = false;

  if (args.action === "accept") {
    // Atomic claim + apply inside the DB (row-locks the item + booking)
    // so concurrent accepts can't double-add or lose an add-on.
    const { data, error } = await supabase.rpc("apply_upsell_item", { p_item_id: item.id });
    if (error) {
      console.error("apply_upsell_item failed", error);
      return { ok: false, error: "Could not add that to your booking", status: 500 };
    }
    changed = data === true;
    if (changed) {
      item.status = "accepted";
      item.responded_at = now;
      item.added_to_booking_at = now;
    }
  } else {
    // Conditional update: only the call that flips pending -> declined "wins".
    const { data } = await supabase
      .from("upsell_items")
      .update({ status: "declined", responded_at: now })
      .eq("id", item.id)
      .eq("status", "pending")
      .select("id");
    changed = !!data && data.length > 0;
    if (changed) {
      item.status = "declined";
      item.responded_at = now;
    }
  }

  // Close the offer once every item has been resolved.
  if (changed && offer.items.every((i) => i.status !== "pending")) {
    await supabase.from("upsell_offers").update({ status: "closed", updated_at: now }).eq("id", offer.id);
    offer.status = "closed";
  }

  return { ok: true, changed, item, offer };
}

/** All offers for a booking (staff view of what was sent + outcomes). */
export async function getOffersForBooking(bookingId: string): Promise<UpsellOfferRecord[]> {
  const supabase = getSupabaseAdminClient();
  const { data: offers } = await supabase
    .from("upsell_offers")
    .select(OFFER_COLS)
    .eq("booking_id", bookingId)
    .order("sent_at", { ascending: false });
  if (!offers || offers.length === 0) return [];
  const ids = offers.map((o) => o.id);
  const { data: items } = await supabase.from("upsell_items").select(ITEM_COLS).in("offer_id", ids);
  const byOffer = new Map<string, UpsellItemRecord[]>();
  for (const it of (items ?? []) as UpsellItemRecord[]) {
    const arr = byOffer.get(it.offer_id) ?? [];
    arr.push(it);
    byOffer.set(it.offer_id, arr);
  }
  return offers.map((o) => ({ ...(o as UpsellOfferRecord), items: byOffer.get(o.id) ?? [] }));
}
