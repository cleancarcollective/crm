import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const DEFAULT_SHOP_SLUG = "christchurch";

export async function GET() {
  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, slug")
    .eq("slug", DEFAULT_SHOP_SLUG)
    .maybeSingle();

  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

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
  const supabase = getSupabaseAdminClient();
  const body = await req.json();
  const { autoRespondEnabled } = body as { autoRespondEnabled?: boolean };

  const { data: shop } = await supabase
    .from("shops")
    .select("id")
    .eq("slug", DEFAULT_SHOP_SLUG)
    .maybeSingle();

  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  await supabase
    .from("shop_settings")
    .upsert(
      { shop_id: shop.id, auto_respond_enabled: autoRespondEnabled ?? false, updated_at: new Date().toISOString() },
      { onConflict: "shop_id" }
    );

  return NextResponse.json({ ok: true });
}
