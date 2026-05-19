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
  const { notes, first_name, last_name, full_name, email, phone } = body as {
    notes?: string;
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
  };

  const supabase = getSupabaseAdminClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (notes !== undefined) updates.notes = notes;

  // Empty string → null so the DB stays clean.
  const norm = (v: string | null | undefined) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const t = v.trim();
    return t.length === 0 ? null : t;
  };

  const first = norm(first_name);
  const last = norm(last_name);
  let fullProvided = norm(full_name);

  if (first !== undefined) updates.first_name = first;
  if (last !== undefined) updates.last_name = last;

  // Recompute full_name from first+last when either changed and the caller
  // didn't override it explicitly.
  if (fullProvided === undefined && (first !== undefined || last !== undefined)) {
    const { data: existing } = await supabase
      .from("contacts")
      .select("first_name, last_name")
      .eq("id", id)
      .eq("shop_id", shop.id)
      .maybeSingle();
    if (existing) {
      const f = first !== undefined ? first : existing.first_name;
      const l = last !== undefined ? last : existing.last_name;
      fullProvided = [f, l].filter(Boolean).join(" ") || null;
    }
  }
  if (fullProvided !== undefined) updates.full_name = fullProvided;

  const emailNorm = norm(email);
  if (emailNorm !== undefined) {
    updates.email = emailNorm ? emailNorm.toLowerCase() : null;
  }

  const phoneNorm = norm(phone);
  if (phoneNorm !== undefined) updates.phone = phoneNorm;

  const { error, count } = await supabase
    .from("contacts")
    .update(updates, { count: "exact" })
    .eq("id", id)
    .eq("shop_id", shop.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if ((count ?? 0) === 0) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
