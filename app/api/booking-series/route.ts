/**
 * POST /api/booking-series
 *
 * Staff-only. Creates a recurring booking series and pre-generates
 * occurrences as `bookings` rows for the next 12 months (or until the
 * end condition). Each occurrence gets the same reminder/SMS wiring as
 * a single manual booking — see lib/bookings/series.ts.
 *
 * v1 only — there is intentionally no PATCH/DELETE here. Edits and
 * cancellations land in step 3 of the build.
 */

import { NextResponse } from "next/server";

import { getCurrentUser, requireCurrentShop } from "@/lib/auth/currentShop";
import {
  resolveContactAndVehicle,
  type NewContactInput,
  type NewVehicleInput,
} from "@/lib/bookings/resolveContactAndVehicle";
import {
  createSeriesAndOccurrences,
  type SeriesEndType,
  type SeriesFrequency,
} from "@/lib/bookings/series";

type RuleBody = {
  frequency: SeriesFrequency;
  intervalCount: number;
  nthWeekOfMonth?: number;
  dayOfWeek?: number;
  firstOccurrenceAt: string; // ISO
  timezone: string;
  endType: SeriesEndType;
  endAfterN?: number;
  endOnDate?: string;
};

type SeriesBody = {
  // Contact — either existing id OR inline new_contact (matches manual booking endpoint).
  contactId?: string;
  newContact?: NewContactInput;
  // Vehicle — same pattern, optional either way.
  vehicleId?: string | null;
  newVehicle?: NewVehicleInput;
  serviceName: string;
  serviceDetails?: string;
  size?: string;
  priceEstimate?: number;
  durationMinutes?: number;
  locationType?: string;
  serviceAddress?: string;
  notes?: string;
  rule: RuleBody;
};

export async function POST(request: Request) {
  let payload: SeriesBody;
  try {
    payload = (await request.json()) as SeriesBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON." }, { status: 400 });
  }

  if (!payload.contactId && !payload.newContact) {
    return NextResponse.json({ success: false, error: "contactId or newContact is required." }, { status: 400 });
  }
  if (!payload.serviceName?.trim()) {
    return NextResponse.json({ success: false, error: "serviceName is required." }, { status: 400 });
  }
  if (!payload.rule?.firstOccurrenceAt || !payload.rule?.timezone || !payload.rule?.frequency) {
    return NextResponse.json({ success: false, error: "rule is incomplete." }, { status: 400 });
  }
  if (payload.rule.endType === "after_n" && !payload.rule.endAfterN) {
    return NextResponse.json({ success: false, error: "endAfterN is required when endType=after_n." }, { status: 400 });
  }
  if (payload.rule.endType === "on_date" && !payload.rule.endOnDate) {
    return NextResponse.json({ success: false, error: "endOnDate is required when endType=on_date." }, { status: 400 });
  }

  const shop = await requireCurrentShop();
  const user = await getCurrentUser();

  // Resolve contact + vehicle up front — supports both "pick existing" and
  // "inline new_contact" payloads, with dedupe-by-email then dedupe-by-phone
  // so we don't create duplicate contact rows.
  let resolved;
  try {
    resolved = await resolveContactAndVehicle({
      shopId: shop.id,
      contactId: payload.contactId ?? null,
      newContact: payload.newContact ?? null,
      vehicleId: payload.vehicleId ?? null,
      newVehicle: payload.newVehicle ?? null,
    });
  } catch (err) {
    console.error("Failed to resolve contact/vehicle for series", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to resolve contact." },
      { status: 500 }
    );
  }

  try {
    const result = await createSeriesAndOccurrences({
      shopId: shop.id,
      contactId: resolved.contactId,
      vehicleId: resolved.vehicleId,
      serviceName: payload.serviceName.trim(),
      serviceDetails: payload.serviceDetails ?? null,
      size: payload.size ?? null,
      priceEstimate: payload.priceEstimate ?? null,
      durationMinutes: payload.durationMinutes ?? null,
      locationType: payload.locationType ?? null,
      serviceAddress: payload.serviceAddress ?? null,
      notes: payload.notes ?? null,
      rule: {
        frequency: payload.rule.frequency,
        intervalCount: payload.rule.intervalCount,
        nthWeekOfMonth: payload.rule.nthWeekOfMonth ?? null,
        dayOfWeek: payload.rule.dayOfWeek ?? null,
        firstOccurrenceAt: new Date(payload.rule.firstOccurrenceAt),
        timezone: payload.rule.timezone,
        endType: payload.rule.endType,
        endAfterN: payload.rule.endAfterN ?? null,
        endOnDate: payload.rule.endOnDate ? new Date(payload.rule.endOnDate) : null,
      },
      createdByUserId: user?.userId ?? null,
      bookedByUserId: user?.userId ?? null,
    });

    return NextResponse.json({
      success: true,
      seriesId: result.seriesId,
      bookingsCreated: result.bookingsCreated,
    });
  } catch (err) {
    console.error("Failed to create booking series", err);
    return NextResponse.json({ success: false, error: "Failed to create series." }, { status: 500 });
  }
}
