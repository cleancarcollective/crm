import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

/**
 * Returns the current shop's pricing list for client-side use (the New
 * Booking modal's service dropdown + size→price auto-fill).
 *
 * Shape: { services: [{ name, sizes: { Small?, Medium?, Large?, XL?, Any? } }] }
 * Each service's `sizes` maps a size label to its ex-GST price. Services
 * priced flat (Ceramic, Paint Correction) only carry an "Any" key.
 *
 * Scope is requireCurrentShop() — the SAME resolver /api/bookings/manual
 * uses — so the prices shown always match the shop the booking lands in.
 */
export async function GET() {
  const shop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("pricing")
    .select("service_name, size, price_ex_gst")
    .eq("shop_id", shop.id)
    .order("service_name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byService = new Map<string, Record<string, number>>();
  for (const row of data ?? []) {
    const name = row.service_name as string;
    const size = (row.size as string) || "Any";
    const price = Number(row.price_ex_gst);
    if (!byService.has(name)) byService.set(name, {});
    byService.get(name)![size] = price;
  }

  const services = Array.from(byService.entries()).map(([name, sizes]) => ({ name, sizes }));
  // Pricing rarely changes; let the browser reuse it for a few minutes so
  // repeat modal opens in a session skip the round-trip entirely.
  return NextResponse.json(
    { services },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
