/**
 * Staff management API (protected — requires valid session cookie).
 *
 * POST /api/admin/staff  →  create a new staff account
 *   body: { email, name, password }
 *
 * GET  /api/admin/staff  →  list all staff accounts (no password hashes)
 */

import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/auth/password";
import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

async function getAuthenticatedUser() {
  // Uses currentShop helper so super-admins managing staff see whichever
  // shop they're currently switched to (not just their home shop).
  return getCurrentUser();
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  // Scope to current user's shop only — staff in other shops aren't visible
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("staff_users")
    .select("id, email, name, created_at")
    .eq("shop_id", user.shop.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: "Failed to list staff." }, { status: 500 });
  return NextResponse.json({ staff: data });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  let body: { email?: string; name?: string; password?: string; shop_slug?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();
  const password = body.password ?? "";

  if (!email || !name || !password) {
    return NextResponse.json({ error: "email, name and password are required." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const passwordHash = hashPassword(password);
  const supabase = getSupabaseAdminClient();

  // Resolve target shop — defaults to creator's shop. An explicit shop_slug
  // override lets you create cross-shop staff (e.g. a CHC admin bootstraps
  // the first WLG user).
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

  const { data, error } = await supabase
    .from("staff_users")
    .insert({ email, name, password_hash: passwordHash, shop_id: targetShopId })
    .select("id, email, name, created_at")
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
