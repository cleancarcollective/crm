/**
 * Staff-only series-wide edit + cancel endpoints. Step 3 of the
 * recurring-bookings build.
 *
 *   PATCH  /api/booking-series/[id]   — bulk-edit safe fields on the series +
 *                                        all future non-overridden occurrences.
 *                                        Rejects recurrence-rule changes — those
 *                                        require cancel + recreate so reminder
 *                                        schedules stay consistent.
 *   POST   /api/booking-series/[id]/cancel — cancel the series and all future
 *                                            non-overridden occurrences,
 *                                            cancel pending reminders, email
 *                                            customer + team.
 *
 * Per-occurrence ("just this one") edits flip booking.series_overridden = true
 * in the existing /api/bookings/[id] handler so this endpoint skips them.
 */

import { addMinutes } from "date-fns";
import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { sendSeriesEditTeamNotification } from "@/lib/email/sendSeriesEditCancelEmails";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type SeriesPatchBody = {
  scope?: "series";
  updates?: {
    serviceName?: string;
    serviceDetails?: string | null;
    size?: string | null;
    priceEstimate?: number | null;
    durationMinutes?: number | null;
    locationType?: string | null;
    serviceAddress?: string | null;
    notes?: string | null;
  };
};

// Whitelist of patchable fields on booking_series + the corresponding column on
// bookings. Keeps the two updates in lockstep without a lot of repetition.
const FIELD_MAP: Array<{
  key: keyof NonNullable<SeriesPatchBody["updates"]>;
  series: string;
  booking: string;
}> = [
  { key: "serviceName", series: "service_name", booking: "service_name" },
  { key: "serviceDetails", series: "service_details", booking: "service_details" },
  { key: "size", series: "size", booking: "" }, // bookings has no size column
  { key: "priceEstimate", series: "price_estimate", booking: "price_estimate" },
  { key: "durationMinutes", series: "duration_minutes", booking: "duration_minutes" },
  { key: "locationType", series: "location_type", booking: "location_type" },
  { key: "serviceAddress", series: "service_address", booking: "service_address" },
  { key: "notes", series: "notes", booking: "notes" },
];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: SeriesPatchBody;
  try {
    body = (await request.json()) as SeriesPatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  if (body.scope !== "series") {
    return NextResponse.json({ ok: false, error: "Missing or invalid scope (expected 'series')." }, { status: 400 });
  }

  // Explicitly reject any recurrence-rule fields. Editing cadence would
  // require regenerating future occurrences and re-scheduling all reminders;
  // cleaner to make the staff member cancel + recreate.
  const rejectedKeys = [
    "frequency",
    "intervalCount",
    "interval_count",
    "firstOccurrenceAt",
    "first_occurrence_at",
    "endType",
    "end_type",
    "endAfterN",
    "end_after_n",
    "endOnDate",
    "end_on_date",
    "nthWeekOfMonth",
    "nth_week_of_month",
    "dayOfWeek",
    "day_of_week",
    "timezone",
  ];
  const updates = body.updates ?? {};
  for (const k of Object.keys(updates)) {
    if (rejectedKeys.includes(k)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Recurrence rule (cadence/timing) cannot be edited. Cancel the series and create a new one to change cadence.",
        },
        { status: 400 }
      );
    }
  }

  const currentShop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();

  const { data: series, error: seriesLoadErr } = await supabase
    .from("booking_series")
    .select("*")
    .eq("id", id)
    .eq("shop_id", currentShop.id)
    .maybeSingle();

  if (seriesLoadErr || !series) {
    return NextResponse.json({ ok: false, error: "Series not found." }, { status: 404 });
  }
  if (series.status === "cancelled") {
    return NextResponse.json({ ok: false, error: "Series is already cancelled." }, { status: 400 });
  }

  // Build sparse update objects from the whitelist.
  const seriesUpdate: Record<string, unknown> = {};
  const bookingUpdate: Record<string, unknown> = {};
  const changeLines: string[] = [];

  for (const f of FIELD_MAP) {
    if (!(f.key in updates)) continue;
    const value = (updates as Record<string, unknown>)[f.key];
    seriesUpdate[f.series] = value ?? null;
    if (f.booking) bookingUpdate[f.booking] = value ?? null;
    changeLines.push(`${f.key}: ${String(series[f.series] ?? "—")} → ${String(value ?? "—")}`);
  }

  if (Object.keys(seriesUpdate).length === 0) {
    return NextResponse.json({ ok: false, error: "No editable fields supplied." }, { status: 400 });
  }

  // If duration changed, scheduled_end has to be recomputed per-booking — do
  // that in a second pass below. The bulk update can't touch scheduled_end
  // without per-row arithmetic.
  const newDuration = "durationMinutes" in updates ? updates.durationMinutes ?? null : undefined;

  const { error: seriesUpdateErr } = await supabase
    .from("booking_series")
    .update(seriesUpdate)
    .eq("id", id)
    .eq("shop_id", currentShop.id);

  if (seriesUpdateErr) {
    return NextResponse.json({ ok: false, error: "Failed to update series." }, { status: 500 });
  }

  // Update future, non-overridden, non-final bookings in this series.
  const nowIso = new Date().toISOString();
  const { data: targets, error: targetsErr } = await supabase
    .from("bookings")
    .select("id, scheduled_start, duration_minutes")
    .eq("series_id", id)
    .eq("shop_id", currentShop.id)
    .eq("series_overridden", false)
    .gt("scheduled_start", nowIso)
    .not("status", "in", "(cancelled,completed)");

  if (targetsErr) {
    return NextResponse.json({ ok: false, error: "Failed to list future bookings." }, { status: 500 });
  }

  let bookingsUpdated = 0;
  if (targets && targets.length > 0) {
    const ids = targets.map((b) => b.id as string);

    if (Object.keys(bookingUpdate).length > 0) {
      const { error: bulkErr } = await supabase
        .from("bookings")
        .update(bookingUpdate)
        .in("id", ids);
      if (bulkErr) {
        return NextResponse.json({ ok: false, error: "Failed to update future bookings." }, { status: 500 });
      }
      bookingsUpdated = ids.length;
    }

    // Recompute scheduled_end per-row when duration changed (or was cleared).
    if (newDuration !== undefined) {
      for (const b of targets) {
        const start = b.scheduled_start as string;
        const end = newDuration ? addMinutes(new Date(start), newDuration).toISOString() : null;
        await supabase.from("bookings").update({ scheduled_end: end }).eq("id", b.id as string);
      }
    }
  }

  // Team-only summary email. Customer sees changes on their next reminder.
  try {
    await sendSeriesEditTeamNotification({
      shopId: currentShop.id,
      seriesId: id,
      serviceName: (seriesUpdate.service_name as string | undefined) ?? series.service_name,
      bookingsUpdated,
      changeLines,
    });
  } catch (err) {
    console.error("Series edit team notification failed (non-fatal)", { seriesId: id, err });
  }

  return NextResponse.json({ ok: true, bookingsUpdated });
}
