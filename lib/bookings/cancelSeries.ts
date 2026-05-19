/**
 * Shared series-cancel core. Used by both the staff endpoint
 * (/api/booking-series/[id]/cancel) and the customer self-service endpoint
 * (/api/public/booking-action with scope='series'). The two callers differ
 * in auth + the team email copy, so those bits stay in the route handlers
 * — this helper just does the DB flips + reminder cleanup.
 *
 * Returns the count of future bookings cancelled and contact info so the
 * caller can fire the customer + team emails.
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type CancelSeriesResult = {
  ok: true;
  series: {
    id: string;
    shop_id: string;
    contact_id: string;
    service_name: string;
  };
  bookingsCancelled: number;
  contact: {
    firstName: string | null;
    fullName: string | null;
    email: string | null;
  } | null;
} | {
  ok: false;
  status: number;
  error: string;
};

/**
 * Flip the series to cancelled, cancel all future non-overridden bookings
 * + their pending reminder jobs, and return enough info for the caller to
 * fire whichever emails it wants.
 *
 * `actor` controls the wording of the audit notes appended to the series
 * and to each cancelled booking. 'staff' and 'customer' both supported.
 */
export async function cancelSeriesCore(args: {
  seriesId: string;
  shopId: string;
  reason: string | null;
  actor: "staff" | "customer";
}): Promise<CancelSeriesResult> {
  const supabase = getSupabaseAdminClient();

  const { data: series, error: loadErr } = await supabase
    .from("booking_series")
    .select("id, shop_id, contact_id, service_name, status, notes")
    .eq("id", args.seriesId)
    .eq("shop_id", args.shopId)
    .maybeSingle();

  if (loadErr || !series) {
    return { ok: false, status: 404, error: "Series not found." };
  }
  if (series.status !== "active" && series.status !== "paused") {
    return { ok: false, status: 400, error: `Series is already ${series.status}.` };
  }

  const actorLabel = args.actor === "staff" ? "staff" : "customer";
  const seriesNote = args.reason
    ? `[Cancelled by ${actorLabel}] ${args.reason}`
    : `[Cancelled by ${actorLabel}]`;
  const bookingNote = `[Series cancelled by ${actorLabel}]`;

  // 1. Flip the series itself.
  await supabase
    .from("booking_series")
    .update({
      status: "cancelled",
      notes: series.notes ? `${series.notes}\n${seriesNote}` : seriesNote,
    })
    .eq("id", args.seriesId)
    .eq("shop_id", args.shopId);

  // 2. Future non-overridden bookings still in flight.
  const nowIso = new Date().toISOString();
  const { data: futures } = await supabase
    .from("bookings")
    .select("id, notes")
    .eq("series_id", args.seriesId)
    .eq("shop_id", args.shopId)
    .eq("series_overridden", false)
    .gt("scheduled_start", nowIso)
    .not("status", "in", "(cancelled,completed)");

  const ids = (futures ?? []).map((r) => r.id as string);

  if (ids.length > 0) {
    // Per-row because we want to append to each existing notes string.
    for (const row of futures ?? []) {
      const bookingId = row.id as string;
      const prior = (row.notes as string | null) ?? null;
      const appended = prior ? `${prior}\n${bookingNote}` : bookingNote;
      await supabase.from("bookings").update({ status: "cancelled", notes: appended }).eq("id", bookingId);
    }

    // Cancel pending reminder jobs.
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

  // 3. Pull contact info for the caller's emails.
  const { data: contact } = await supabase
    .from("contacts")
    .select("first_name, full_name, email")
    .eq("id", series.contact_id)
    .maybeSingle();

  return {
    ok: true,
    series: {
      id: series.id as string,
      shop_id: series.shop_id as string,
      contact_id: series.contact_id as string,
      service_name: series.service_name as string,
    },
    bookingsCancelled: ids.length,
    contact: contact
      ? {
          firstName: (contact.first_name as string | null) ?? null,
          fullName: (contact.full_name as string | null) ?? null,
          email: (contact.email as string | null) ?? null,
        }
      : null,
  };
}
