/**
 * Staff credit-ledger management for a contact.
 *   GET  - ledger rows + balance
 *   POST - { delta_dollars, reason } grant (positive) or deduct (negative)
 * Admin-only: prepaid credit is money-equivalent.
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { isAdminRole } from "@/lib/auth/roles";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user)) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { id } = await params;
  const supabase = getSupabaseAdminClient();
  const { data: rows } = await supabase
    .from("credit_ledger")
    .select("id, delta_cents, reason, booking_id, created_by, created_at")
    .eq("contact_id", id)
    .eq("shop_id", user.shop.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const balance = (rows ?? []).reduce((sum, r) => sum + (r.delta_cents ?? 0), 0);
  return NextResponse.json({ balance_cents: balance, rows: rows ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user)) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { id } = await params;
  let body: { delta_dollars?: number; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const dollars = Number(body.delta_dollars);
  const reason = (body.reason ?? "").trim().slice(0, 200);
  if (!Number.isFinite(dollars) || dollars === 0 || Math.abs(dollars) > 10000) {
    return NextResponse.json({ error: "Amount must be non-zero and under $10,000" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "Reason is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();

  // Contact must exist in this shop.
  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", id)
    .eq("shop_id", user.shop.id)
    .maybeSingle();
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const { error } = await supabase.from("credit_ledger").insert({
    contact_id: id,
    shop_id: user.shop.id,
    delta_cents: Math.round(dollars * 100),
    reason,
    created_by: user.name ?? user.email ?? "staff",
  });
  if (error) {
    console.error("credit grant failed", error);
    return NextResponse.json({ error: "Could not save credit entry" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
