/**
 * GET /r/<short_code>
 *
 * Resolves a short URL to its full target and 302-redirects. Used by SMS
 * touchpoints to keep the message under 160 chars. Best-effort visit
 * tracking (visit_count + last_visited_at).
 */

import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  if (!code || code.length < 4 || code.length > 32) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: row } = await supabase
    .from("short_urls")
    .select("full_url, expires_at, visit_count")
    .eq("short_code", code)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return NextResponse.json({ error: "Link expired" }, { status: 410 });
  }

  // Fire-and-forget visit increment so the redirect isn't gated on a DB write.
  void supabase
    .from("short_urls")
    .update({
      visit_count: (row.visit_count ?? 0) + 1,
      last_visited_at: new Date().toISOString(),
    })
    .eq("short_code", code);

  return NextResponse.redirect(row.full_url, { status: 302 });
}
