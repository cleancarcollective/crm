/**
 * POST /api/booking-series/[id]/resume
 *
 * Staff-only. Flips a paused series back to active and triggers an immediate
 * horizon regen so the calendar tops up right away rather than waiting on the
 * daily cron.
 */

import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { regenerateSeriesOccurrences } from "@/lib/bookings/series";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const currentShop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();

  const { data: series, error: loadErr } = await supabase
    .from("booking_series")
    .select("id, shop_id, status")
    .eq("id", id)
    .eq("shop_id", currentShop.id)
    .maybeSingle();

  if (loadErr || !series) {
    return NextResponse.json({ ok: false, error: "Series not found." }, { status: 404 });
  }
  if (series.status !== "paused") {
    return NextResponse.json(
      { ok: false, error: `Cannot resume a series that is ${series.status}.` },
      { status: 400 }
    );
  }

  const { error: updateErr } = await supabase
    .from("booking_series")
    .update({ status: "active" })
    .eq("id", id)
    .eq("shop_id", currentShop.id);

  if (updateErr) {
    return NextResponse.json({ ok: false, error: "Failed to resume series." }, { status: 500 });
  }

  // Top up the horizon now so staff see fresh occurrences immediately.
  const regenResult = await regenerateSeriesOccurrences(id);

  return NextResponse.json({ ok: true, regenResult });
}
