/**
 * GET  /api/settings/sms-templates       — list all SMS templates for the shop
 * POST /api/settings/sms-templates/seed  — seed defaults if any are missing (idempotent)
 */

import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { SMS_TEMPLATE_DEFAULTS } from "@/lib/sms/smsTemplateDefaults";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function GET() {
  const shop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();

  const { data: templates, error } = await supabase
    .from("sms_templates")
    .select("id, template_key, name, body_text, is_active, updated_at")
    .eq("shop_id", shop.id)
    .order("template_key");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: templates ?? [] });
}
