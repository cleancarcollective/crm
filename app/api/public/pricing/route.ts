/**
 * GET /api/public/pricing?shop=wellington|christchurch
 *
 * Public, read-only price list for the marketing site. One source of
 * truth: service_offerings (the same table the sales Services page and
 * the estimate templates read). Christchurch applies the live booking-form
 * price experiment multiplier, mirroring services/pricing.ts expPrice() in
 * Christchurch-Booking-System, so the website shows what the booking form
 * charges. The WordPress shortcode [ccc_price] renders from this.
 *
 * Shape: { shop, experiment, updated_at, services: [{ service_id, name,
 *   category, from, sizes: { "Coupe / Hatchback": 355, ... } }] }
 * Prices are whole dollars, ex-GST.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Keep in sync with Christchurch-Booking-System/services/pricing.ts PRICE_EXPERIMENT.
const CHC_PRICE_EXPERIMENT = { id: "chc-web-15off-2026-07", multiplier: 0.85 };

type Offering = {
  service_id: string;
  display_name: string;
  category: string | null;
  popularity_rank: number | null;
  is_active: boolean;
  updated_at: string | null;
  pricing_table: Record<string, { price?: number; price_from?: number; price_to?: number }> | null;
};

export async function GET(req: NextRequest) {
  const shop = (req.nextUrl.searchParams.get("shop") || "wellington").toLowerCase();
  if (!["wellington", "christchurch"].includes(shop)) {
    return NextResponse.json({ error: "shop must be wellington or christchurch" }, { status: 400 });
  }
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("service_offerings")
    .select("service_id, display_name, category, popularity_rank, is_active, updated_at, pricing_table")
    .eq("is_active", true)
    .order("popularity_rank", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const mult = shop === "christchurch" ? CHC_PRICE_EXPERIMENT.multiplier : 1;
  const adj = (n: number) => Math.round(n * mult);
  let updatedAt = "";
  const services = ((data ?? []) as Offering[]).map((o) => {
    if (o.updated_at && o.updated_at > updatedAt) updatedAt = o.updated_at;
    const sizes: Record<string, number> = {};
    for (const [size, row] of Object.entries(o.pricing_table ?? {})) {
      const base = typeof row?.price === "number" ? row.price : typeof row?.price_from === "number" ? row.price_from : null;
      if (base !== null) sizes[size] = adj(base);
    }
    const prices = Object.values(sizes);
    return {
      service_id: o.service_id,
      name: o.display_name,
      category: o.category,
      from: prices.length ? Math.min(...prices) : null,
      sizes,
    };
  });

  return NextResponse.json(
    { shop, experiment: shop === "christchurch" ? CHC_PRICE_EXPERIMENT.id : null, updated_at: updatedAt || null, gst: "excluded", services },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400", "Access-Control-Allow-Origin": "*" } }
  );
}
