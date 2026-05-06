/**
 * POST /api/settings/templates/preview
 *
 * Renders a template (subject + body_text) against live pricing using
 * sample lead data — so the editor can show an accurate preview before saving.
 *
 * Body: { template_key, subject, body_text, sample?: { first_name, make, model, size } }
 */

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { buildTemplateContext, type PricingMap } from "@/lib/autorespond/templateRenderer";
import type { TemplateKey } from "@/lib/autorespond/templates";
import type { VehicleSize } from "@/lib/autorespond/vehicleSizing";
import { requireCurrentShop } from "@/lib/auth/currentShop";

type PreviewBody = {
  template_key?: TemplateKey;
  subject?: string;
  body_text?: string;
  sample?: {
    first_name?: string;
    make?: string;
    model?: string;
    size?: VehicleSize;
  };
};

function substitute(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(ctx, key)) return ctx[key];
    return match;
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as PreviewBody;

  if (!body.template_key || typeof body.subject !== "string" || typeof body.body_text !== "string") {
    return NextResponse.json({ error: "Missing template_key / subject / body_text" }, { status: 400 });
  }

  const shop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();

  const { data: pricingRows } = await supabase
    .from("pricing")
    .select("service_name, size, price_ex_gst")
    .eq("shop_id", shop.id);

  const pricing: PricingMap = new Map();
  for (const r of pricingRows ?? []) {
    pricing.set(`${r.service_name}|${r.size}`, Number(r.price_ex_gst));
  }

  const sample = body.sample ?? {};
  const ctx = buildTemplateContext(
    body.template_key,
    sample.first_name ?? "Alex",
    sample.make ?? "Toyota",
    sample.model ?? "Corolla",
    sample.size ?? "Medium",
    pricing
  );

  return NextResponse.json({
    subject: substitute(body.subject, ctx),
    body_text: substitute(body.body_text, ctx),
    context: ctx,
  });
}
