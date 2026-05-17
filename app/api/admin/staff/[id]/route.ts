/**
 * Per-staff-member API. Admin-only.
 *
 * PATCH /api/admin/staff/<id>   update role (admin/contractor)
 *                                body: { role }
 * DELETE /api/admin/staff/<id>  remove the staff account
 *
 * Self-modification guarded — an admin can't demote or delete themselves
 * (prevents accidental lockout).
 */

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorised." }, { status: 401 }) };
  if (user.role !== "admin") return { error: NextResponse.json({ error: "Admin role required." }, { status: 403 }) };
  return { user };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const user = auth.user;
  const { id } = await params;

  if (id === user.userId) {
    return NextResponse.json({ error: "Can't modify your own account here." }, { status: 400 });
  }

  let body: { role?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const role = body.role === "contractor" ? "contractor" : "admin";

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("staff_users")
    .update({ role })
    .eq("id", id)
    .eq("shop_id", user.shop.id)
    .select("id, email, name, role")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Failed to update staff." }, { status: 500 });
  return NextResponse.json({ success: true, staff: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const user = auth.user;
  const { id } = await params;

  if (id === user.userId) {
    return NextResponse.json({ error: "Can't delete your own account." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("staff_users")
    .delete()
    .eq("id", id)
    .eq("shop_id", user.shop.id);
  if (error) return NextResponse.json({ error: "Failed to delete staff." }, { status: 500 });
  return NextResponse.json({ success: true });
}
