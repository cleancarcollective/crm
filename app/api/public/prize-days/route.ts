import { NextResponse } from "next/server";

import { prizeFullDays, SECOND_PRIZE } from "@/lib/giveaway/secondPrize";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

/**
 * GET /api/public/prize-days?shop=wellington
 *
 * Days already holding the daily cap of giveaway second-prize bookings. The
 * booking form greys these out for prize claims only. Read straight from the
 * bookings table and never cached: the calendar-backed availability endpoint
 * is edge-cached, which let several claims land on one slot (2 Nov).
 */

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("shop");
  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase.from("shops").select("id, timezone").eq("slug", slug ?? "").maybeSingle();
  if (!shop) return withCors(NextResponse.json({ error: "Unknown or missing shop slug." }, { status: 400 }));
  try {
    const full = await prizeFullDays(supabase, shop.id, shop.timezone);
    return withCors(NextResponse.json({ cap: SECOND_PRIZE.dayCap, full }));
  } catch {
    return withCors(NextResponse.json({ cap: SECOND_PRIZE.dayCap, full: [] }, { status: 503 }));
  }
}
