/**
 * POST - staff explicitly sends the collected photo set to the
 * customer. One branded email covering everything not yet sent;
 * re-sending later only announces new photos. 400 when there is
 * nothing new to send.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { sendDetailPhotosEmail } from "@/lib/portal/photoEmails";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const shop = await requireCurrentShop();
  const { id } = await params;
  const supabase = getSupabaseAdminClient();

  const { count: unsent } = await supabase
    .from("detail_photos")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", id)
    .eq("shop_id", shop.id)
    .eq("notified", false);
  if (!unsent) {
    return NextResponse.json({ error: "Nothing new to send" }, { status: 400 });
  }

  try {
    const sent = await sendDetailPhotosEmail({ bookingId: id });
    if (!sent) {
      return NextResponse.json({ error: "Customer has no email on file" }, { status: 400 });
    }
    await supabase
      .from("detail_photos")
      .update({ notified: true })
      .eq("booking_id", id)
      .eq("shop_id", shop.id);
    return NextResponse.json({ ok: true, sent_count: unsent });
  } catch (err) {
    console.error("photo notify failed", err);
    return NextResponse.json({ error: "Email failed - try again" }, { status: 500 });
  }
}
