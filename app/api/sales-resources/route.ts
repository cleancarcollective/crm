import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

/**
 * GET /api/sales-resources
 *   Lists sales playbook entries (script + objection cards + opener/closing
 *   text) for the current shop. Returns global rows (shop_id = null) plus
 *   any shop-specific overrides. Visible to admin / contractor / sales.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("sales_resources")
    .select("*")
    .or(`shop_id.is.null,shop_id.eq.${user.shop.id}`)
    .order("display_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ resources: data ?? [] });
}

/**
 * POST /api/sales-resources
 *   Create a new sales resource (objection card, opener, etc). Admin only.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { slug, type, title, body_markdown, display_order, shop_specific } = body as {
    slug?: string;
    type?: string;
    title?: string;
    body_markdown?: string;
    display_order?: number;
    shop_specific?: boolean;
  };

  if (!slug || !type || !title || typeof body_markdown !== "string") {
    return NextResponse.json({ error: "slug, type, title, body_markdown required" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("sales_resources")
    .insert({
      slug,
      type,
      title,
      body_markdown,
      display_order: display_order ?? 100,
      shop_id: shop_specific ? user.shop.id : null,
      updated_by_user_id: user.userId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ resource: data });
}
