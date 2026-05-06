import { NextRequest, NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function GET() {
  const shop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();

  const { data: settings } = await supabase
    .from("shop_settings")
    .select("auto_respond_enabled")
    .eq("shop_id", shop.id)
    .maybeSingle();

  const { data: pricing } = await supabase
    .from("pricing")
    .select("id, service_name, size, price_ex_gst")
    .eq("shop_id", shop.id)
    .order("service_name")
    .order("size");

  return NextResponse.json({
    shopId: shop.id,
    autoRespondEnabled: settings?.auto_respond_enabled ?? false,
    pricing: pricing ?? [],
  });
}

export async function PATCH(req: NextRequest) {
  const shop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();
  const body = await req.json();
  const { autoRespondEnabled } = body as { autoRespondEnabled?: boolean };

  await supabase
    .from("shop_settings")
    .upsert(
      { shop_id: shop.id, auto_respond_enabled: autoRespondEnabled ?? false, updated_at: new Date().toISOString() },
      { onConflict: "shop_id" }
    );

  return NextResponse.json({ ok: true });
}
