import { NextRequest, NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const shop = await requireCurrentShop();
  const body = await req.json();
  const supabase = getSupabaseAdminClient();

  const allowed: Record<string, unknown> = {};
  if (typeof body.name === "string") allowed.name = body.name;
  if (typeof body.body_text === "string") allowed.body_text = body.body_text;
  if (typeof body.is_active === "boolean") allowed.is_active = body.is_active;
  allowed.updated_at = new Date().toISOString();

  if (Object.keys(allowed).length <= 1) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("sms_templates")
    .update(allowed)
    .eq("id", id)
    .eq("shop_id", shop.id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ template: data });
}
