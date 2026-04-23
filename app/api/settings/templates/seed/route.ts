/**
 * POST /api/settings/templates/seed
 *
 * One-time seeder: inserts default templates for the shop if any are missing.
 * Idempotent — safe to re-run. Existing templates are not overwritten.
 */

import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { TEMPLATE_DEFAULTS } from "@/lib/autorespond/templateDefaults";

const DEFAULT_SHOP_SLUG = "christchurch";

export async function POST() {
  const supabase = getSupabaseAdminClient();

  const { data: shop } = await supabase
    .from("shops")
    .select("id")
    .eq("slug", DEFAULT_SHOP_SLUG)
    .maybeSingle();

  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  // Load existing to avoid overwriting customised rows
  const { data: existing } = await supabase
    .from("lead_email_templates")
    .select("template_key, variant")
    .eq("shop_id", shop.id);

  const existingKeys = new Set((existing ?? []).map((r) => `${r.template_key}|${r.variant}`));

  const toInsert = TEMPLATE_DEFAULTS
    .filter((d) => !existingKeys.has(`${d.template_key}|${d.variant}`))
    .map((d) => ({
      shop_id: shop.id,
      template_key: d.template_key,
      variant: d.variant,
      name: d.name,
      subject: d.subject,
      body_text: d.body_text,
      is_active: true,
    }));

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, message: "All defaults already present." });
  }

  const { error } = await supabase.from("lead_email_templates").insert(toInsert);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: toInsert.length });
}
