import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

/**
 * PATCH /api/sales-resources/[id]
 *   Update title / body_markdown / display_order on a sales resource.
 *   Writeable by admin + sales (sales reps are encouraged to refine the
 *   playbook). Contractor cannot write.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "sales") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { title, body_markdown, display_order } = body as {
    title?: string;
    body_markdown?: string;
    display_order?: number;
  };

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by_user_id: user.userId,
  };
  if (title !== undefined) updates.title = title;
  if (body_markdown !== undefined) updates.body_markdown = body_markdown;
  if (display_order !== undefined) updates.display_order = display_order;

  if (Object.keys(updates).length <= 2) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  // Sales can only edit global rows or their own shop's rows.
  const { data: existing } = await supabase
    .from("sales_resources")
    .select("shop_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.shop_id && existing.shop_id !== user.shop.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("sales_resources")
    .update(updates)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/sales-resources/[id]
 *   Admin only.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("sales_resources").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
