/**
 * Staff detail-photo uploads for a booking.
 *
 *   POST   { photos: [{ data: base64-jpeg, kind, label }] } → stores in
 *          the detail-photos bucket + rows in detail_photos. Pairs
 *          arrive pre-composited (side-by-side before/after, branded,
 *          client-side canvas). NO auto-email: staff send explicitly
 *          via the sibling /notify route once the set looks right.
 *   GET    → photo list for the booking (staff view)
 *   DELETE ?photo_id= → remove a shot (mistakes happen)
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const MAX_BATCH = 12;
const MAX_BYTES = 8 * 1024 * 1024; // per photo, post-compression

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const shop = await requireCurrentShop();
  const { id } = await params;
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from("detail_photos")
    .select("id, public_url, kind, label, notified, created_at")
    .eq("booking_id", id)
    .eq("shop_id", shop.id)
    .order("created_at", { ascending: true });
  return NextResponse.json({ photos: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const shop = await requireCurrentShop();
  const user = await getCurrentUser();
  const { id } = await params;

  let body: { photos?: Array<{ data?: string; kind?: string; label?: string }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const photos = (body.photos ?? []).slice(0, MAX_BATCH);
  if (photos.length === 0) return NextResponse.json({ error: "No photos" }, { status: 400 });

  const supabase = getSupabaseAdminClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, shop_id, contact_id, service_name, scheduled_start")
    .eq("id", id)
    .eq("shop_id", shop.id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const uploaded: Array<{ id: string; public_url: string }> = [];
  for (const p of photos) {
    if (!p.data) continue;
    const b64 = p.data.replace(/^data:image\/\w+;base64,/, "");
    const buf = Buffer.from(b64, "base64");
    if (buf.length === 0 || buf.length > MAX_BYTES) continue;

    const path = `${shop.id}/${id}/${randomUUID()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from("detail-photos")
      .upload(path, buf, { contentType: "image/jpeg", upsert: false });
    if (upErr) {
      console.error("photo upload failed", upErr);
      continue;
    }
    const { data: pub } = supabase.storage.from("detail-photos").getPublicUrl(path);
    const kind = p.kind === "pair" || p.kind === "before" || p.kind === "after" ? p.kind : "during";
    const { data: row, error: insErr } = await supabase
      .from("detail_photos")
      .insert({
        booking_id: id,
        shop_id: shop.id,
        contact_id: booking.contact_id,
        storage_path: path,
        public_url: pub.publicUrl,
        kind,
        label: (p.label ?? "").trim().slice(0, 60) || null,
        created_by: user?.name ?? "staff",
      })
      .select("id, public_url")
      .single();
    if (!insErr && row) uploaded.push(row);
  }

  if (uploaded.length === 0) {
    return NextResponse.json({ error: "Nothing uploaded" }, { status: 500 });
  }

  // No auto-send: pairs collect in the panel and staff explicitly send
  // via /photos/notify when they're happy with the set. The portal
  // shows everything as soon as it's uploaded either way.
  return NextResponse.json({ ok: true, uploaded: uploaded.length });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const shop = await requireCurrentShop();
  const { id } = await params;
  const photoId = req.nextUrl.searchParams.get("photo_id") ?? "";
  if (!photoId) return NextResponse.json({ error: "Missing photo_id" }, { status: 400 });

  const supabase = getSupabaseAdminClient();
  const { data: photo } = await supabase
    .from("detail_photos")
    .select("id, storage_path")
    .eq("id", photoId)
    .eq("booking_id", id)
    .eq("shop_id", shop.id)
    .maybeSingle();
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await supabase.storage.from("detail-photos").remove([photo.storage_path]);
  await supabase.from("detail_photos").delete().eq("id", photo.id);
  return NextResponse.json({ ok: true });
}
