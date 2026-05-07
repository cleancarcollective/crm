import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { SMS_TEMPLATE_DEFAULTS } from "@/lib/sms/smsTemplateDefaults";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function POST() {
  const shop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();

  const { data: existing } = await supabase
    .from("sms_templates")
    .select("template_key")
    .eq("shop_id", shop.id);

  const existingKeys = new Set((existing ?? []).map((r) => r.template_key));
  const toInsert = SMS_TEMPLATE_DEFAULTS.filter((d) => !existingKeys.has(d.template_key)).map((d) => ({
    shop_id: shop.id,
    template_key: d.template_key,
    name: d.name,
    body_text: d.body_text,
    is_active: true,
  }));

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 });
  }

  const { error } = await supabase.from("sms_templates").insert(toInsert);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, inserted: toInsert.length });
}
