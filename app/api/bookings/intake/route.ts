import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { mapBookingPayload } from "@/lib/bookingIntake/mapPayload";
import type { BookingIntakePayload } from "@/lib/bookingIntake/types";
import { upsertContact } from "@/lib/bookingIntake/upsertContact";
import { upsertVehicle } from "@/lib/bookingIntake/upsertVehicle";
import { createReminderJobsForBooking } from "@/lib/email/scheduledReminderJobs";
import { sendBookingConfirmationEmail } from "@/lib/email/sendBookingConfirmation";
import { sendTeamBookingNotification } from "@/lib/email/sendTeamBookingNotification";
import { cancelLeadJobs } from "@/lib/scheduling/leadJobs";
import { sendTnzSms } from "@/lib/sms/tnzClient";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type ShopRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
};

type LeadMatchRow = {
  id: string;
  status: string;
  template_id: string | null;
  template_key: string | null;
  template_variant: string | null;
};

// Any lead that hasn't been explicitly won/lost is still "open" — so when a
// booking comes in we can attribute it back, including leads that got an
// auto-respond estimate (status: 'sent') or were waiting for approval.
const OPEN_LEAD_STATUSES = ["new", "contacted", "quoted", "clicked", "sent", "needs_approval"];

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
    const existingLead = await getLatestOpenLeadForContact(supabase, shop.id, contact.id);

    // Deduplication: reject if an identical booking was created in the last 5 minutes
    const { data: recentDupe } = await supabase
      .from("bookings")
      .select("id, contact_id")
      .eq("shop_id", shop.id)
      .eq("contact_id", contact.id)
      .eq("service_name", normalized.data.booking.serviceName)
      .eq("scheduled_start", normalized.data.booking.scheduledStart)
      .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();

    if (recentDupe) {
      return withCors(NextResponse.json({
        success: true,
        booking_id: recentDupe.id,
        contact_id: contact.id,
        vehicle_id: vehicle.id,
        deduplicated: true,
      }));
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        shop_id: shop.id,
        contact_id: contact.id,
        vehicle_id: vehicle.id,
        lead_id: existingLead?.id ?? null,
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

    if (existingLead) {
      // Attribute the conversion back to the original lead source.
      // - If the lead received an auto-respond estimate (template_id present),
      //   the booking is attributed to that template → won_source='auto_email'
      // - Otherwise the customer booked without an estimate email → 'direct_booking'
      //   (e.g. they called, or the lead was still in 'new'/'needs_approval').
      const wonSource = existingLead.template_id ? "auto_email" : "direct_booking";

      const { error: leadUpdateError } = await supabase
        .from("leads")
        .update({
          status: "won",
          won_source: wonSource,
          booked_at: booking.created_at,
          vehicle_id: vehicle.id,
        })
        .eq("id", existingLead.id);

      if (leadUpdateError) {
        throw leadUpdateError;
      }

      // Cancel any pending follow-up emails — no point pestering them now
      // that they've booked.
      await cancelLeadJobs(existingLead.id, [
        "lead_auto_estimate",
        "lead_followup_3day",
        "lead_followup_7day",
      ]);
    }

    try {
      const reminderJobs = await createReminderJobsForBooking({
        shop: shop as ShopRow,
        bookingId: booking.id,
        contactId: contact.id,
        scheduledStart: booking.scheduled_start
      });
      console.info("Scheduled reminder jobs created", {
        bookingId: booking.id,
        count: reminderJobs.length
      });
    } catch (reminderError) {
      console.error("Failed to create scheduled reminder jobs", reminderError);
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

    // Send booking confirmation SMS to customer
    if (contact.phone) {
      try {
        const firstName = contact.first_name ?? contact.full_name?.split(" ")[0] ?? "there";
        const dateLabel = formatInTimeZone(booking.scheduled_start, (shop as ShopRow).timezone, "EEE d MMM 'at' h:mm a");
        const smsMessage = `Hi ${firstName}, your booking is confirmed for ${dateLabel}. See you soon! - Clean Car Collective`;
        const smsResult = await sendTnzSms(contact.phone, smsMessage);
        console.info("Booking confirmation SMS result", { bookingId: booking.id, smsResult });
      } catch (smsError) {
        console.error("Booking confirmation SMS failed", smsError);
      }
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
    const errMsg = error instanceof Error ? error.message : String(error);

    return withCors(NextResponse.json(
      {
        success: false,
        error: "Internal server error.",
        _debug: errMsg
      },
      { status: 500 }
    ));
  }
}

async function getLatestOpenLeadForContact(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  shopId: string,
  contactId: string
) {
  const { data, error } = await supabase
    .from("leads")
    .select("id, status, template_id, template_key, template_variant")
    .eq("shop_id", shopId)
    .eq("contact_id", contactId)
    .in("status", OPEN_LEAD_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as LeadMatchRow | null;
}
