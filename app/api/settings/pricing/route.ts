import { NextRequest, NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function PUT(req: NextRequest) {
  const shop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();
  const body = await req.json();
  const { rows } = body as {
    rows: Array<{ service_name: string; size: string; price_ex_gst: number }>;
  };

  const upsertRows = rows.map((r) => ({
    shop_id: shop.id,
    service_name: r.service_name,
    size: r.size,
    price_ex_gst: r.price_ex_gst,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("pricing")
    .upsert(upsertRows, { onConflict: "shop_id,service_name,size" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
