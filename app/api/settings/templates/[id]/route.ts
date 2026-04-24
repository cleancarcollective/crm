/**
 * GET   /api/settings/templates/[id]  — fetch a single template
 * PATCH /api/settings/templates/[id]  — update subject / body_text / name / is_active
 */

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const DEFAULT_SHOP_SLUG = "christchurch";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("lead_email_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ template: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const supabase = getSupabaseAdminClient();

  // Only allow editing copy + enabled state + weight — never change shop_id/key/variant
  const allowed: Record<string, unknown> = {};
  if (typeof body.name === "string") allowed.name = body.name;
  if (typeof body.subject === "string") allowed.subject = body.subject;
  if (typeof body.body_text === "string") allowed.body_text = body.body_text;
  if (typeof body.is_active === "boolean") allowed.is_active = body.is_active;
  if (typeof body.weight === "number" && body.weight >= 0 && body.weight <= 1000) {
    allowed.weight = Math.round(body.weight);
  }
  allowed.updated_at = new Date().toISOString();

  if (Object.keys(allowed).length <= 1) {
    return NextResponse.json({ error: "No editable fields supplied." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("lead_email_templates")
    .update(allowed)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ template: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseAdminClient();

  // Don't let the user delete the last active variant of a template_key —
  // otherwise auto-respond would have nothing to send.
  const { data: target } = await supabase
    .from("lead_email_templates")
    .select("shop_id, template_key")
    .eq("id", id)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { count } = await supabase
    .from("lead_email_templates")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", target.shop_id)
    .eq("template_key", target.template_key);

  if ((count ?? 0) <= 1) {
    return NextResponse.json(
      { error: "Can't delete the only variant for this template. Pause it instead." },
      { status: 400 }
    );
  }

  const { error: delErr } = await supabase.from("lead_email_templates").delete().eq("id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
