/**
 * POST /api/booking-series/[id]/pause
 *
 * Staff-only. Pauses an active series so the regen cron stops advancing the
 * horizon. Existing future occurrences stay on the calendar — pausing is
 * non-destructive. Use /cancel to also cancel the existing futures.
 */

import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
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
  if (series.status !== "active") {
    return NextResponse.json(
      { ok: false, error: `Cannot pause a series that is ${series.status}.` },
      { status: 400 }
    );
  }

  const { error: updateErr } = await supabase
    .from("booking_series")
    .update({ status: "paused" })
    .eq("id", id)
    .eq("shop_id", currentShop.id);

  if (updateErr) {
    return NextResponse.json({ ok: false, error: "Failed to pause series." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
