/**
 * GET  /api/settings/templates        — list all templates for the shop (with perf stats)
 * POST /api/settings/templates/seed   — seed defaults if table empty (one-time)
 */

import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const DEFAULT_SHOP_SLUG = "christchurch";

export async function GET() {
  const supabase = getSupabaseAdminClient();

  const { data: shop } = await supabase
    .from("shops")
    .select("id")
    .eq("slug", DEFAULT_SHOP_SLUG)
    .maybeSingle();

  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const { data: templates, error } = await supabase
    .from("email_templates")
    .select("id, template_key, variant, name, subject, body_text, is_active, created_at, updated_at")
    .eq("shop_id", shop.id)
    .order("template_key")
    .order("variant");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Build 30-day performance stats per template_id.
  // Engagement (opened/clicked) comes from denorm columns updated by the
  // Postmark webhook; conversion comes from the lead's terminal status.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: statRows } = await supabase
    .from("leads")
    .select("template_id, status, email_opened_at, email_clicked_at")
    .eq("shop_id", shop.id)
    .not("template_id", "is", null)
    .gte("created_at", thirtyDaysAgo);

  type Perf = { sent: number; opened: number; clicked: number; won: number; lost: number; needs_approval: number };
  const empty: Perf = { sent: 0, opened: 0, clicked: 0, won: 0, lost: 0, needs_approval: 0 };
  const perf: Record<string, Perf> = {};

  for (const row of statRows ?? []) {
    const id = row.template_id as string | null;
    if (!id) continue;
    if (!perf[id]) perf[id] = { ...empty };
    if (row.status === "sent" || row.status === "clicked" || row.status === "won" || row.status === "lost") {
      perf[id].sent += 1;
    }
    if (row.email_opened_at) perf[id].opened += 1;
    if (row.email_clicked_at) perf[id].clicked += 1;
    if (row.status === "won") perf[id].won += 1;
    if (row.status === "lost") perf[id].lost += 1;
    if (row.status === "needs_approval") perf[id].needs_approval += 1;
  }

  const withPerf = (templates ?? []).map((t) => ({
    ...t,
    performance: perf[t.id] ?? { ...empty },
  }));

  return NextResponse.json({ templates: withPerf });
}
