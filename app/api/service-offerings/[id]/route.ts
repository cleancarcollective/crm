import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

/**
 * PATCH /api/service-offerings/[id]
 *   Admin only. Updates the editable copy fields on a service offering.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { description, what_included, selling_points, notes, pricing_table, display_name, category, is_active } =
    body as {
      description?: string;
      what_included?: string;
      selling_points?: string;
      notes?: string;
      pricing_table?: unknown;
      display_name?: string;
      category?: string;
      is_active?: boolean;
    };

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (description !== undefined) updates.description = description;
  if (what_included !== undefined) updates.what_included = what_included;
  if (selling_points !== undefined) updates.selling_points = selling_points;
  if (notes !== undefined) updates.notes = notes;
  if (pricing_table !== undefined) updates.pricing_table = pricing_table;
  if (display_name !== undefined) updates.display_name = display_name;
  if (category !== undefined) updates.category = category;
  if (is_active !== undefined) updates.is_active = is_active;

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("service_offerings")
    .update(updates)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
