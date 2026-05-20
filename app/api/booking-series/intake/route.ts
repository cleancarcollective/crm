/**
 * POST /api/booking-series/intake
 *
 * Public (CORS-enabled, no auth). Customer-facing booking forms POST here
 * when the customer picked a recurring cadence on the summary screen — we
 * create a `booking_series` row, pre-generate the next 12 months of
 * occurrences, and apply the chosen discount.
 *
 * Mirrors /api/bookings/intake in payload shape so the form only has to
 * branch its target URL. The only addition is a `recurrence` object that
 * encodes cadence + discount.
 *
 * Phase A only supports `discount_source: 'customer_signup'`. Phase B
 * (post-detail SMS/email upsell) will reuse the same endpoint with
 * `discount_source: 'post_detail_offer'` — keep the validation generous
 * enough that a future client can pass it without code changes here.
 */
import { NextResponse } from "next/server";

import { mapBookingPayload } from "@/lib/bookingIntake/mapPayload";
import type { BookingIntakePayload } from "@/lib/bookingIntake/types";
import { resolveContactAndVehicle } from "@/lib/bookings/resolveContactAndVehicle";
import {
  createSeriesAndOccurrences,
  describeMonthlyNthWeekday,
} from "@/lib/bookings/series";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type ShopRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
};

type RecurrenceBody = {
  // 2 / 3 / 4 — shorthand for "every N months on the same Nth-weekday".
  // The endpoint derives interval_count + frequency itself.
  cadence_months: number;
  // 5 / 10 / 15. Stored on booking_series.discount_percent. Already
  // applied to the priceEstimate we save on the series.
  discount_percent: number;
  // Phase A: 'customer_signup'. Phase B will add 'post_detail_offer'.
  // We accept any string and just record it — validation lives in the
  // form, not the intake.
  discount_source?: string;
};

type SeriesIntakePayload = BookingIntakePayload & {
  recurrence?: RecurrenceBody;
};

function withCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: Request) {
  let payload: SeriesIntakePayload;

  try {
    payload = (await request.json()) as SeriesIntakePayload;
  } catch {
    return withCors(
      NextResponse.json(
        { success: false, error: "Invalid JSON payload." },
        { status: 400 }
      )
    );
  }

  // Validate the recurrence object up front — cheaper to fail fast than
  // resolve the contact + vehicle and then bail.
  const recurrence = payload.recurrence;
  if (!recurrence) {
    return withCors(
      NextResponse.json(
        { success: false, error: "recurrence is required for series intake." },
        { status: 400 }
      )
    );
  }
  if (![2, 3, 4].includes(recurrence.cadence_months)) {
    return withCors(
      NextResponse.json(
        {
          success: false,
          error: "recurrence.cadence_months must be 2, 3, or 4.",
        },
        { status: 400 }
      )
    );
  }
  if (
    typeof recurrence.discount_percent !== "number" ||
    recurrence.discount_percent < 0 ||
    recurrence.discount_percent > 100
  ) {
    return withCors(
      NextResponse.json(
        {
          success: false,
          error: "recurrence.discount_percent must be 0-100.",
        },
        { status: 400 }
      )
    );
  }

  // Same two-pass validation as /api/bookings/intake — first pass to
  // pull shop_slug out, then re-run with the timezone we just looked up.
  const initialValidation = mapBookingPayload(payload);
  if (!initialValidation.success) {
    return withCors(
      NextResponse.json(
        {
          success: false,
          error: "Validation failed.",
          details: initialValidation.errors,
        },
        { status: 400 }
      )
    );
  }

  const supabase = getSupabaseAdminClient();

  try {
    const { data: shop, error: shopError } = await supabase
      .from("shops")
      .select("id, name, slug, timezone")
      .eq("slug", initialValidation.data.shopSlug)
      .maybeSingle();

    if (shopError) {
      throw shopError;
    }

    if (!shop) {
      return withCors(
        NextResponse.json(
          {
            success: false,
            error: `Shop not found for slug '${initialValidation.data.shopSlug}'.`,
          },
          { status: 404 }
        )
      );
    }

    const shopRow = shop as ShopRow;

    const normalized = mapBookingPayload(payload, {
      defaultShopSlug: shopRow.slug,
      timezone: shopRow.timezone,
    });

    if (!normalized.success) {
      return withCors(
        NextResponse.json(
          {
            success: false,
            error: "Validation failed.",
            details: normalized.errors,
          },
          { status: 400 }
        )
      );
    }

    // Resolve contact + vehicle using the shared helper. We synthesize a
    // newContact payload from the normalized booking data — this keeps the
    // intake payload identical to /api/bookings/intake without duplicating
    // the contact-dedupe logic that endpoint runs inline.
    const c = normalized.data.contact;
    const v = normalized.data.vehicle;
    const resolved = await resolveContactAndVehicle({
      shopId: shopRow.id,
      newContact: {
        first_name: c.firstName,
        last_name: c.lastName,
        email: c.email,
        phone: c.phone,
      },
      newVehicle: {
        make: v.make,
        model: v.model,
        year: v.year,
        rego: v.rego,
        size: v.size,
      },
    });

    // Compute the Nth-weekday-of-month rule from the first booking date.
    // The form already picked a calendar date in the shop's timezone, and
    // mapBookingPayload converted it to a UTC ISO via fromZonedTime. To
    // describe it in the shop's local calendar we need the LOCAL date —
    // re-parse the payload date string directly (it's `YYYY-MM-DD`) so
    // describeMonthlyNthWeekday sees the right day-of-month.
    const localDateStr =
      (payload.appointment_date as string | undefined) ??
      (payload["Event Date"] as string | undefined);
    const localTimeStr =
      (payload.appointment_time as string | undefined) ??
      (payload["Event Time"] as string | undefined);
    if (!localDateStr || !localTimeStr) {
      return withCors(
        NextResponse.json(
          { success: false, error: "Missing appointment_date or appointment_time." },
          { status: 400 }
        )
      );
    }

    // Local-calendar Date — used only to feed describeMonthlyNthWeekday,
    // which reads getDate() / getDay(). We DON'T use this for scheduling.
    const [y, m, d] = localDateStr.split("-").map(Number);
    const localDate = new Date(y, (m ?? 1) - 1, d ?? 1);
    const { nthWeek, dayOfWeek } = describeMonthlyNthWeekday(
      localDate,
      shopRow.timezone
    );

    // The actual first-occurrence instant is the UTC moment computed by
    // mapBookingPayload. That ISO already represents "10am local on day X
    // in this timezone", so series.ts can compute subsequent occurrences
    // by jumping months from it.
    const firstOccurrenceAt = new Date(
      normalized.data.booking.scheduledStart
    );

    // Apply the discount to the price we store on the series. The form
    // is already sending the discounted total in `total_price`, but we
    // re-derive here so the server is the source of truth — a malicious
    // client can't fabricate a deeper discount.
    const submittedPrice = normalized.data.booking.priceEstimate ?? 0;
    const discountedPrice = Math.round(
      submittedPrice * (1 - recurrence.discount_percent / 100) * 100
    ) / 100;

    const result = await createSeriesAndOccurrences({
      shopId: shopRow.id,
      contactId: resolved.contactId,
      vehicleId: resolved.vehicleId,
      serviceName: normalized.data.booking.serviceName,
      serviceDetails: normalized.data.booking.serviceDetails,
      size: v.size ?? null,
      // Server-recomputed discounted price — see comment above.
      priceEstimate: discountedPrice,
      durationMinutes: normalized.data.booking.durationMinutes,
      locationType: normalized.data.booking.locationType,
      serviceAddress: normalized.data.booking.serviceAddress,
      notes: normalized.data.booking.notes,
      rule: {
        frequency: "months_nth_weekday",
        intervalCount: recurrence.cadence_months,
        nthWeekOfMonth: nthWeek,
        dayOfWeek: dayOfWeek,
        firstOccurrenceAt,
        timezone: shopRow.timezone,
        endType: "never",
      },
      discountPercent: recurrence.discount_percent,
      discountSource: recurrence.discount_source ?? "customer_signup",
      seriesSource: "customer_signup",
    });

    console.info("Booking series intake created", {
      seriesId: result.seriesId,
      bookingsCreated: result.bookingsCreated,
      shop: shopRow.slug,
      cadenceMonths: recurrence.cadence_months,
      discountPercent: recurrence.discount_percent,
    });

    return withCors(
      NextResponse.json({
        ok: true,
        success: true,
        series_id: result.seriesId,
        bookings_created: result.bookingsCreated,
        contact_id: resolved.contactId,
        vehicle_id: resolved.vehicleId,
      })
    );
  } catch (error) {
    console.error("Booking series intake failed", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return withCors(
      NextResponse.json(
        {
          success: false,
          error: "Internal server error.",
          _debug: errMsg,
        },
        { status: 500 }
      )
    );
  }
}
