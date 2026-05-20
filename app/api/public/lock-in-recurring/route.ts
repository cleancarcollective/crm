/**
 * POST /api/public/lock-in-recurring
 *
 * Token-authed customer-facing endpoint (Phase C). Verifies a
 * `lock_in_recurring` signed token (minted by the post-detail touchpoint
 * emails / SMS — see lib/email/sendPostDetailOffer.ts), then creates a
 * booking_series for the contact with discount_source='post_detail_offer'.
 *
 * createSeriesAndOccurrences already cancels any remaining touchpoints for
 * the contact when a series is created (and writes a friendly last_error
 * naming the post-detail offer as the trigger), so we don't have to do
 * that here.
 *
 * After a successful lock-in we consume the token so a refresh of the
 * success page (or a re-POST) returns "already used" instead of creating
 * a second series. We also guard against the originating booking having
 * been linked to a series since the token was minted — belt + braces.
 */

import { fromZonedTime } from "date-fns-tz";
import { NextResponse } from "next/server";

import { consumeActionToken, verifyActionToken } from "@/lib/auth/signedTokens";
import {
  createSeriesAndOccurrences,
  describeMonthlyNthWeekday,
} from "@/lib/bookings/series";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type Body = {
  token?: string;
  cadence_months?: number;
  start_date?: string;
  start_time?: string;
};

function discountForCadence(months: number): number | null {
  if (months === 2) return 15;
  if (months === 3) return 10;
  if (months === 4) return 5;
  return null;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  const cadenceMonths = body.cadence_months;
  if (cadenceMonths !== 2 && cadenceMonths !== 3 && cadenceMonths !== 4) {
    return NextResponse.json(
      { error: "cadence_months must be 2, 3, or 4." },
      { status: 400 }
    );
  }
  const discountPercent = discountForCadence(cadenceMonths);
  if (discountPercent == null) {
    return NextResponse.json({ error: "Invalid cadence." }, { status: 400 });
  }
  if (!body.start_date) {
    return NextResponse.json({ error: "Missing start_date" }, { status: 400 });
  }

  const verify = await verifyActionToken(body.token, {
    requireAction: "lock_in_recurring",
    checkConsumed: true,
  });
  if (!verify.ok) {
    return NextResponse.json({ error: `Token: ${verify.reason}` }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, shop_id, series_id, contact_id, vehicle_id, service_name, service_details, size, price_estimate, duration_minutes, location_type, service_address, scheduled_start")
    .eq("id", verify.payload.r)
    .eq("shop_id", verify.payload.s)
    .maybeSingle();

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.series_id) {
    return NextResponse.json(
      { error: "You're already on a recurring rate." },
      { status: 400 }
    );
  }

  const { data: shop } = await supabase
    .from("shops")
    .select("id, timezone")
    .eq("id", booking.shop_id)
    .maybeSingle();
  if (!shop) {
    return NextResponse.json({ error: "Shop not found" }, { status: 500 });
  }

  // Derive the time-of-day from the original booking when start_time is
  // omitted — same hour:minute the customer is used to.
  const startTime = body.start_time
    && /^\d{2}:\d{2}$/.test(body.start_time)
    ? body.start_time
    : new Date(booking.scheduled_start).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: shop.timezone,
      });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) {
    return NextResponse.json(
      { error: "start_date must be YYYY-MM-DD." },
      { status: 400 }
    );
  }

  // Local-zone date → UTC instant. Same approach as
  // lib/bookingIntake/mapPayload.ts.
  let firstOccurrenceAt: Date;
  try {
    firstOccurrenceAt = fromZonedTime(`${body.start_date} ${startTime}`, shop.timezone);
  } catch {
    return NextResponse.json({ error: "Invalid start_date or start_time." }, { status: 400 });
  }
  if (Number.isNaN(firstOccurrenceAt.getTime())) {
    return NextResponse.json({ error: "Invalid start_date or start_time." }, { status: 400 });
  }

  // describeMonthlyNthWeekday wants a local-calendar Date (it reads
  // getDate()/getDay() raw), so build one from the YYYY-MM-DD string.
  const [y, m, d] = body.start_date.split("-").map(Number);
  const localDate = new Date(y, (m ?? 1) - 1, d ?? 1);
  const { nthWeek, dayOfWeek } = describeMonthlyNthWeekday(localDate, shop.timezone);

  const basePrice = booking.price_estimate ?? 0;
  const discountedPrice = basePrice
    ? Math.round(basePrice * (1 - discountPercent / 100) * 100) / 100
    : null;

  try {
    const result = await createSeriesAndOccurrences({
      shopId: booking.shop_id,
      contactId: booking.contact_id,
      vehicleId: booking.vehicle_id,
      serviceName: booking.service_name,
      serviceDetails: booking.service_details,
      size: booking.size ?? null,
      priceEstimate: discountedPrice,
      durationMinutes: booking.duration_minutes,
      locationType: booking.location_type,
      serviceAddress: booking.service_address,
      notes: null,
      rule: {
        frequency: "months_nth_weekday",
        intervalCount: cadenceMonths,
        nthWeekOfMonth: nthWeek,
        dayOfWeek: dayOfWeek,
        firstOccurrenceAt,
        timezone: shop.timezone,
        endType: "never",
      },
      discountPercent,
      // Critical — this is what tells createSeriesAndOccurrences to write
      // the post-detail-specific last_error onto the cancelled touchpoint
      // jobs (see lib/bookings/series.ts and postDetailTouchpoints.ts).
      discountSource: "post_detail_offer",
      seriesSource: "post_detail_offer",
    });

    // Single-use token — record consumption so a refresh / replay returns
    // a "link already used" page.
    try {
      await consumeActionToken(body.token, verify.payload);
    } catch (err) {
      console.error("Failed to mark lock-in token consumed (non-fatal)", err);
    }

    console.info("Post-detail lock-in series created", {
      seriesId: result.seriesId,
      bookingsCreated: result.bookingsCreated,
      originatingBookingId: booking.id,
      cadenceMonths,
      discountPercent,
    });

    return NextResponse.json({
      ok: true,
      series_id: result.seriesId,
      bookings_created: result.bookingsCreated,
    });
  } catch (err) {
    console.error("Lock-in recurring failed", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to create recurring series.", _debug: errMsg },
      { status: 500 }
    );
  }
}
