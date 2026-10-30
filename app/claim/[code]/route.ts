/**
 * GET /claim/<entry code>
 *
 * The one link in the giveaway second-prize email (lib/giveaway/secondPrize.ts).
 * Finds the entry by its referral code, mints the booking-form claim link with
 * a fresh prefill token for that entry, and 302s to it. An unknown code still
 * lands on the booking form with the prize applied, just without prefill.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { GIVEAWAY, parseEntryTag } from "@/lib/giveaway/wlgOct2026";
import { claimUrl } from "@/lib/giveaway/secondPrize";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = (raw || "").toUpperCase();
  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("slug", GIVEAWAY.shopSlug).maybeSingle();
  if (!shop) return NextResponse.redirect(claimUrl(null, ""), 302);

  let leadId: string | null = null;
  if (/^[A-Z2-9]{8}$/.test(code)) {
    const { data } = await supabase
      .from("leads")
      .select("id, internal_notes")
      .eq("shop_id", shop.id)
      .like("internal_notes", `%"code":"${code}"%`)
      .limit(5);
    leadId = (data ?? []).find((r) => parseEntryTag(r.internal_notes as string | null)?.code === code)?.id ?? null;
  }
  return NextResponse.redirect(claimUrl(leadId, shop.id), 302);
}
