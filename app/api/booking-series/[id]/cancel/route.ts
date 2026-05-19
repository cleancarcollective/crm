/**
 * POST /api/booking-series/[id]/cancel
 *
 * Staff-only. Cancels a recurring series and all future non-overridden
 * bookings, cancels pending reminders for those bookings, then emails the
 * customer + team. See app/api/booking-series/[id]/route.ts for the edit
 * counterpart.
 */

import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import {
  sendSeriesCancelCustomerEmail,
  sendSeriesCancelTeamNotification,
} from "@/lib/email/sendSeriesEditCancelEmails";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type Body = {
  scope?: "series";
  reason?: string | null;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    body = {};
  }
  if (body.scope && body.scope !== "series") {
    return NextResponse.json({ ok: false, error: "Invalid scope." }, { status: 400 });
  }
  const reason = (body.reason ?? "").trim() || null;

  const currentShop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();

  const { data: series, error: loadErr } = await supabase
    .from("booking_series")
    .select("*")
    .eq("id", id)
    .eq("shop_id", currentShop.id)
    .maybeSingle();

  if (loadErr || !series) {
    return NextResponse.json({ ok: false, error: "Series not found." }, { status: 404 });
  }
  if (series.status !== "active" && series.status !== "paused") {
    return NextResponse.json(
      { ok: false, error: `Series is already ${series.status}.` },
      { status: 400 }
    );
  }

  // 1. Flip the series itself.
  const seriesNote = reason ? `[Cancelled by staff] ${reason}` : "[Cancelled by staff]";
  await supabase
    .from("booking_series")
    .update({
      status: "cancelled",
      notes: series.notes ? `${series.notes}\n${seriesNote}` : seriesNote,
    })
    .eq("id", id)
    .eq("shop_id", currentShop.id);

  // 2. Find future non-overridden bookings still in flight.
  const nowIso = new Date().toISOString();
  const { data: futures } = await supabase
    .from("bookings")
    .select("id, notes")
    .eq("series_id", id)
    .eq("shop_id", currentShop.id)
    .eq("series_overridden", false)
    .gt("scheduled_start", nowIso)
    .not("status", "in", "(cancelled,completed)");

  const ids = (futures ?? []).map((r) => r.id as string);

  // 3. Cancel them. Per-row so we can append the cancel note without
  //    clobbering existing notes — cheap, there are at most ~50 of these.
  if (ids.length > 0) {
    for (const row of futures ?? []) {
      const id = row.id as string;
      const prior = (row.notes as string | null) ?? null;
      const appended = prior ? `${prior}\n[Series cancelled by staff]` : "[Series cancelled by staff]";
      await supabase.from("bookings").update({ status: "cancelled", notes: appended }).eq("id", id);
    }

    // 4. Cancel pending reminder jobs for those bookings.
    await supabase
      .from("scheduled_email_jobs")
      .update({ status: "cancelled", last_error: "Series cancelled" })
      .in("booking_id", ids)
      .eq("status", "pending");
    await supabase
      .from("scheduled_sms_jobs")
      .update({ status: "cancelled", last_error: "Series cancelled" })
      .in("booking_id", ids)
      .eq("status", "pending");
  }

  // 5. Customer + team emails. Non-fatal — cancellation already committed.
  const { data: contact } = await supabase
    .from("contacts")
    .select("first_name, full_name, email")
    .eq("id", series.contact_id)
    .maybeSingle();

  try {
    await sendSeriesCancelCustomerEmail({
      shopId: currentShop.id,
      seriesId: id,
      serviceName: series.service_name,
      remainingCancelled: ids.length,
      reason,
      customerEmail: contact?.email ?? null,
      customerFirstName: contact?.first_name ?? contact?.full_name?.split(" ")[0] ?? null,
    });
  } catch (err) {
    console.error("Series cancel customer email failed (non-fatal)", { seriesId: id, err });
  }
  try {
    await sendSeriesCancelTeamNotification({
      shopId: currentShop.id,
      seriesId: id,
      serviceName: series.service_name,
      remainingCancelled: ids.length,
      reason,
      customerName: contact?.full_name ?? null,
      customerEmail: contact?.email ?? null,
    });
  } catch (err) {
    console.error("Series cancel team notification failed (non-fatal)", { seriesId: id, err });
  }

  return NextResponse.json({ ok: true, bookingsCancelled: ids.length });
}
