/**
 * Staff management API. Admin-only.
 *
 * GET    /api/admin/staff           list staff at the current shop (no hashes)
 * POST   /api/admin/staff           create a new staff account
 *                                   body: { email, name, password, role?, shop_slug? }
 */

import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/auth/password";
import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorised." }, { status: 401 }) };
  if (user.role !== "admin") return { error: NextResponse.json({ error: "Admin role required." }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("staff_users")
    .select("id, email, name, role, is_super_admin, created_at")
    .eq("shop_id", auth.user.shop.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: "Failed to list staff." }, { status: 500 });
  return NextResponse.json({ staff: data });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const user = auth.user;

  let body: { email?: string; name?: string; password?: string; role?: string; shop_slug?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();
  const password = body.password ?? "";
  const role = body.role === "contractor"
    ? "contractor"
    : body.role === "sales"
      ? "sales"
      : "admin";

  if (!email || !name || !password) {
    return NextResponse.json({ error: "email, name and password are required." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const passwordHash = hashPassword(password);
  const supabase = getSupabaseAdminClient();

  let targetShopId = user.shop.id;
  if (body.shop_slug && body.shop_slug !== user.shop.slug) {
    const { data: shop } = await supabase
      .from("shops")
      .select("id")
      .eq("slug", body.shop_slug)
      .maybeSingle();
    if (!shop) {
      return NextResponse.json({ error: `Shop not found: ${body.shop_slug}` }, { status: 400 });
    }
    targetShopId = shop.id as string;
  }

  // Sales users get assigned_shop_id = their home shop. Keeps the scope
  // explicit and matches what the session loader expects (it looks up
  // assigned shop by id, falling back to home shop if unset, but for
  // sales we always want the explicit assignment).
  const insertRow: Record<string, unknown> = {
    email,
    name,
    password_hash: passwordHash,
    shop_id: targetShopId,
    role,
  };
  if (role === "sales") {
    insertRow.assigned_shop_id = targetShopId;
  }

  const { data, error } = await supabase
    .from("staff_users")
    .insert(insertRow)
    .select("id, email, name, role, created_at")
    .single();

  if (error) {
    const isDuplicate = error.code === "23505";
    return NextResponse.json(
      { error: isDuplicate ? "A staff account with that email already exists." : "Failed to create account." },
      { status: isDuplicate ? 409 : 500 }
    );
  }

  return NextResponse.json({ success: true, staff: data }, { status: 201 });
}
