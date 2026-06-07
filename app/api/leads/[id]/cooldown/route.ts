/**
 * Cool-down toggle for sales leads.
 *
 * POST   /api/leads/[id]/cooldown   { reason: string, until: ISO8601 }
 *   → flags the lead with a resurface date + reason, removes it from
 *     warm/cold/frozen until now() passes `until`.
 *
 * DELETE /api/leads/[id]/cooldown
 *   → clears the flag; lead returns to whichever age-bucket it belongs in.
 *
 * Auth: sales + owners/admins (whoever currentShop already authorises for
 * lead edits). Shop scope checked against the user's assigned/active shop.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireCurrentShop, getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function leadScopeFor(user: { role: string; shop: { id: string }; assignedShop?: { id: string } | null }) {
  // Sales users are pinned to their assigned shop; everyone else uses active.
  if (user.role === "sales") return user.assignedShop?.id ?? user.shop.id;
  return user.shop.id;
}

// Lead-edit roles. Mirrors the dashboard's edit permissions; sales has
// been allowed to edit leads since 2026-05-21.
const ALLOWED_ROLES = new Set(["admin", "sales"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCurrentShop();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!ALLOWED_ROLES.has(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const untilRaw = typeof body.until === "string" ? body.until.trim() : "";

  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }
  const untilDate = untilRaw ? new Date(untilRaw) : null;
  if (!untilDate || isNaN(untilDate.getTime())) {
    return NextResponse.json({ error: "until must be a valid ISO date" }, { status: 400 });
  }
  if (untilDate.getTime() <= Date.now()) {
    return NextResponse.json({ error: "until must be in the future" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const shopId = leadScopeFor(user);

  const { error, count } = await supabase
    .from("leads")
    .update(
      {
        cooldown_until: untilDate.toISOString(),
        cooldown_reason: reason.slice(0, 1000),
        cooldown_set_by: user.userId ?? null,
        cooldown_set_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("id", id)
    .eq("shop_id", shopId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if ((count ?? 0) === 0) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCurrentShop();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!ALLOWED_ROLES.has(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseAdminClient();
  const shopId = leadScopeFor(user);
  const { error, count } = await supabase
    .from("leads")
    .update(
      {
        cooldown_until: null,
        cooldown_reason: null,
        cooldown_set_by: null,
        cooldown_set_at: null,
        updated_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("id", id)
    .eq("shop_id", shopId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if ((count ?? 0) === 0) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
