/**
 * POST /api/settings/templates/[id]/duplicate
 *
 * Creates a new A/B variant of the given template. Picks the next available
 * variant letter (A → B → C, etc.) and seeds it with a copy of the source
 * template's subject + body. Rebalances weights so the source + new variant
 * split 50/50.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const shop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();

  // Load source template — scoped to current shop
  const { data: source, error: sourceErr } = await supabase
    .from("lead_email_templates")
    .select("*")
    .eq("id", id)
    .eq("shop_id", shop.id)
    .maybeSingle();

  if (sourceErr || !source) {
    return NextResponse.json({ error: "Source template not found" }, { status: 404 });
  }

  // Find existing variants for this (shop, template_key)
  const { data: existing } = await supabase
    .from("lead_email_templates")
    .select("id, variant, weight")
    .eq("shop_id", source.shop_id)
    .eq("template_key", source.template_key);

  const taken = new Set((existing ?? []).map((v) => v.variant));
  const nextLetter = LETTERS.find((l) => !taken.has(l));
  if (!nextLetter) {
    return NextResponse.json({ error: "Too many variants (max 10)" }, { status: 400 });
  }

  // Insert the new variant — 50/50 split with the source by default
  const { data: newVariant, error: insertErr } = await supabase
    .from("lead_email_templates")
    .insert({
      shop_id: source.shop_id,
      template_key: source.template_key,
      variant: nextLetter,
      name: `${source.name} — Variant ${nextLetter}`,
      subject: source.subject,
      body_text: source.body_text,
      is_active: true,
      weight: 50,
    })
    .select("*")
    .single();

  if (insertErr || !newVariant) {
    return NextResponse.json(
      { error: `Failed to create variant: ${insertErr?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  // Rebalance source to 50 (if currently 100, i.e. first split)
  if ((source.weight ?? 100) === 100) {
    await supabase
      .from("lead_email_templates")
      .update({ weight: 50 })
      .eq("id", source.id);
  }

  return NextResponse.json({ template: newVariant });
}
