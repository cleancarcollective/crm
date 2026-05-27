import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

/**
 * GET /api/service-offerings
 *   Lists the active service catalogue. Visible to admin, contractor, sales.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("service_offerings")
    .select("*")
    .eq("is_active", true)
    .or(`shop_id.is.null,shop_id.eq.${user.shop.id}`)
    .order("popularity_rank", { ascending: true, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ offerings: data ?? [] });
}
