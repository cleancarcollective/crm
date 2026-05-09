import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ACTIVE_SHOP_COOKIE } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

/**
 * Set the active shop cookie. Only super-admins can switch.
 *
 * Body: { slug: string }
 *
 * Sets the active-shop cookie if the slug matches a real shop. The cookie
 * is HttpOnly so the client can't tamper with it; the actual access check
 * happens server-side every request via verifySession(activeShopSlug).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!user.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden — super-admin required" }, { status: 403 });
  }

  let body: { slug?: string };
  try {
    body = (await request.json()) as { slug?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const slug = body.slug?.trim();
  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });

  // Validate the slug matches a real shop
  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const cookieStore = await cookies();
  // If switching back to home shop, clear the override cookie entirely
  if (slug === user.homeShop.slug) {
    cookieStore.delete(ACTIVE_SHOP_COOKIE);
  } else {
    cookieStore.set(ACTIVE_SHOP_COOKIE, slug, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // Same lifespan as the session
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return NextResponse.json({ success: true, slug });
}
