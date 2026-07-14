/**
 * Staff upsell offers for a booking.
 *
 *   POST { items: [{ addon_id?, title, description?, price_cents,
 *          duration_min?, photos?: [base64-jpeg] }] }
 *          → uploads photos, creates one offer with these items, and
 *            texts the customer an auto-login link (email fallback).
 *   GET  → offers + items for this booking (staff view of outcomes).
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser, requireCurrentShop } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createOffer, getOffersForBooking, type NewUpsellItem } from "@/lib/upsells/data";
import { sendOfferToCustomer } from "@/lib/upsells/notify";

const MAX_ITEMS = 8;
const MAX_PHOTOS_PER_ITEM = 4;
const MAX_BYTES = 8 * 1024 * 1024;

type IncomingItem = {
  addon_id?: string | null;
  title?: string;
  description?: string;
  price_cents?: number;
  duration_min?: number;
  photos?: string[];
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireCurrentShop();
  const { id } = await params;
  const offers = await getOffersForBooking(id);
  return NextResponse.json({ offers });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const shop = await requireCurrentShop();
  const user = await getCurrentUser();
  const { id } = await params;

  let body: { items?: IncomingItem[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const incoming = (body.items ?? []).slice(0, MAX_ITEMS);
  if (incoming.length === 0) return NextResponse.json({ error: "Add at least one upsell" }, { status: 400 });

  const supabase = getSupabaseAdminClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, shop_id, contact_id")
    .eq("id", id)
    .eq("shop_id", shop.id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (!booking.contact_id) return NextResponse.json({ error: "Booking has no customer on file" }, { status: 400 });

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, first_name, email, phone")
    .eq("id", booking.contact_id)
    .maybeSingle();
  if (!contact?.email) {
    return NextResponse.json({ error: "Customer has no email on file - can't send" }, { status: 400 });
  }

  // Build items, uploading any photos to the bucket first.
  const items: NewUpsellItem[] = [];
  for (const raw of incoming) {
    const title = (raw.title ?? "").trim().slice(0, 120);
    const priceCents = Math.max(0, Math.round(Number(raw.price_cents) || 0));
    if (!title || priceCents <= 0) continue;

    const photoUrls: string[] = [];
    for (const dataUrl of (raw.photos ?? []).slice(0, MAX_PHOTOS_PER_ITEM)) {
      const b64 = (dataUrl ?? "").replace(/^data:image\/\w+;base64,/, "");
      const buf = Buffer.from(b64, "base64");
      if (buf.length === 0 || buf.length > MAX_BYTES) continue;
      const path = `${shop.id}/${id}/upsell/${randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("detail-photos")
        .upload(path, buf, { contentType: "image/jpeg", upsert: false });
      if (upErr) {
        console.error("upsell photo upload failed", upErr);
        continue;
      }
      const { data: pub } = supabase.storage.from("detail-photos").getPublicUrl(path);
      photoUrls.push(pub.publicUrl);
    }

    items.push({
      addon_id: raw.addon_id ? String(raw.addon_id).slice(0, 60) : null,
      title,
      description: (raw.description ?? "").trim().slice(0, 400) || null,
      price_cents: priceCents,
      duration_min: Math.max(0, Math.round(Number(raw.duration_min) || 0)),
      photo_paths: photoUrls,
    });
  }

  if (items.length === 0) return NextResponse.json({ error: "No valid items (need a title + price)" }, { status: 400 });

  const offer = await createOffer({
    bookingId: booking.id,
    contactId: booking.contact_id,
    shopId: booking.shop_id,
    createdBy: user?.name ?? "staff",
    items,
  });
  if (!offer) return NextResponse.json({ error: "Could not create offer" }, { status: 500 });

  const channel = await sendOfferToCustomer({
    offerId: offer.id,
    email: contact.email,
    phone: contact.phone ?? null,
    firstName: contact.first_name ?? null,
    shopId: booking.shop_id,
    itemCount: items.length,
  });

  await supabase
    .from("upsell_offers")
    .update({ sent_via: channel, updated_at: new Date().toISOString() })
    .eq("id", offer.id);

  return NextResponse.json({ ok: true, offerId: offer.id, channel, itemCount: items.length });
}
