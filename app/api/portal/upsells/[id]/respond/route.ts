/**
 * POST /api/portal/upsells/[id]/respond
 * Body: { item_id, action: "accept" | "decline" }
 *
 * Session-cookie authed. Accepting appends the add-on to the booking
 * (instant, no staff approval) and pings the team. Declining just marks
 * it. Idempotent per item.
 */

import { NextRequest, NextResponse } from "next/server";

import { getPortalSession } from "@/lib/portal/session";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { respondToItem } from "@/lib/upsells/data";
import { notifyTeamOfResponse } from "@/lib/upsells/notify";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  let body: { item_id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const itemId = body.item_id ?? "";
  const action = body.action === "decline" ? "decline" : "accept";
  if (!itemId) return NextResponse.json({ error: "Missing item" }, { status: 400 });

  const result = await respondToItem({ offerId: id, itemId, action, email: session.email });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });

  // Notify the team only when this call actually resolved the item.
  if (result.changed) {
    const supabase = getSupabaseAdminClient();
    const { data: contact } = await supabase
      .from("contacts")
      .select("first_name, last_name, full_name")
      .eq("id", result.offer.contact_id)
      .maybeSingle();
    const contactName =
      contact?.full_name ||
      [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") ||
      "A customer";
    await notifyTeamOfResponse({
      shopId: result.offer.shop_id,
      contactName,
      itemTitle: result.item.title,
      priceCents: result.item.price_cents,
      durationMin: result.item.duration_min,
      accepted: action === "accept",
      bookingId: result.offer.booking_id,
    });
  }

  return NextResponse.json({ ok: true, item: result.item, offerStatus: result.offer.status });
}
