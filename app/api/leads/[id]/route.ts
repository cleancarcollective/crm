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
  const { status, won_source, notes, source } = body as { status?: string; won_source?: string; notes?: string; source?: string };

  const supabase = getSupabaseAdminClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // Field-only updates (no status change)
  if (!status) {
    if (notes !== undefined) updates.notes = notes;
    if (source !== undefined) updates.source = source;
    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const { error } = await supabase
      .from("leads")
      .update(updates)
      .eq("id", id)
      .eq("shop_id", shop.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const VALID_STATUSES = ["new", "contacted", "quoted", "clicked", "won", "lost", "needs_approval", "sent", "scheduled"];
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  updates.status = status;
  if (status === "won") {
    updates.won_source = won_source ?? null;
    updates.booked_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("leads")
    .update(updates)
    .eq("id", id)
    .eq("shop_id", shop.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("PATCH lead error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  return NextResponse.json({ lead: data });
}
