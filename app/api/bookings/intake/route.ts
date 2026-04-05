import { NextResponse } from "next/server";

import { mapBookingPayload } from "@/lib/bookingIntake/mapPayload";
import type { BookingIntakePayload } from "@/lib/bookingIntake/types";
import { upsertContact } from "@/lib/bookingIntake/upsertContact";
import { upsertVehicle } from "@/lib/bookingIntake/upsertVehicle";
import { sendBookingConfirmationEmail } from "@/lib/email/sendBookingConfirmation";
import { sendTeamBookingNotification } from "@/lib/email/sendTeamBookingNotification";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type ShopRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
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
  let payload: BookingIntakePayload;

  try {
    payload = (await request.json()) as BookingIntakePayload;
  } catch {
    return withCors(NextResponse.json(
      {
        success: false,
        error: "Invalid JSON payload."
      },
      { status: 400 }
    ));
  }

  const initialValidation = mapBookingPayload(payload);
  if (!initialValidation.success) {
    return withCors(NextResponse.json(
      {
        success: false,
        error: "Validation failed.",
        details: initialValidation.errors
      },
      { status: 400 }
    ));
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
      return withCors(NextResponse.json(
        {
          success: false,
          error: `Shop not found for slug '${initialValidation.data.shopSlug}'.`
        },
        { status: 404 }
      ));
    }

    const normalized = mapBookingPayload(payload, {
      defaultShopSlug: (shop as ShopRow).slug,
      timezone: (shop as ShopRow).timezone
    });

    if (!normalized.success) {
      return withCors(NextResponse.json(
        {
          success: false,
          error: "Validation failed.",
          details: normalized.errors
        },
        { status: 400 }
      ));
    }

    const contact = await upsertContact(supabase, shop.id, normalized.data.contact);
    const vehicle = await upsertVehicle(supabase, shop.id, contact.id, normalized.data.vehicle);

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        shop_id: shop.id,
        contact_id: contact.id,
        vehicle_id: vehicle.id,
        lead_id: null,
        booking_source: normalized.data.booking.bookingSource,
        service_name: normalized.data.booking.serviceName,
        service_details: normalized.data.booking.serviceDetails,
        scheduled_start: normalized.data.booking.scheduledStart,
        scheduled_end: normalized.data.booking.scheduledEnd,
        status: normalized.data.booking.status,
        price_estimate: normalized.data.booking.priceEstimate,
        notes: normalized.data.booking.notes,
        service_id: normalized.data.booking.serviceId,
        duration_minutes: normalized.data.booking.durationMinutes,
        location_type: normalized.data.booking.locationType,
        raw_payload: normalized.data.booking.rawPayload
      })
      .select("*")
      .single();

    if (bookingError) {
      throw bookingError;
    }

    try {
      const emailResult = await sendBookingConfirmationEmail({
        shop: shop as ShopRow,
        booking: {
          ...booking,
          contact,
          vehicle
        }
      });
      console.info("Booking confirmation email result", {
        bookingId: booking.id,
        emailResult
      });
    } catch (emailError) {
      console.error("Booking confirmation email failed", emailError);
    }

    try {
      const teamEmailResult = await sendTeamBookingNotification({
        shop: shop as ShopRow,
        booking: {
          ...booking,
          contact,
          vehicle
        }
      });
      console.info("Team booking notification result", {
        bookingId: booking.id,
        teamEmailResult
      });
    } catch (teamEmailError) {
      console.error("Team booking notification failed", teamEmailError);
    }

    return withCors(NextResponse.json({
      success: true,
      booking_id: booking.id,
      contact_id: contact.id,
      vehicle_id: vehicle.id,
      booking
    }));
  } catch (error) {
    console.error("Booking intake failed", error);

    return withCors(NextResponse.json(
      {
        success: false,
        error: "Internal server error."
      },
      { status: 500 }
    ));
  }
}
