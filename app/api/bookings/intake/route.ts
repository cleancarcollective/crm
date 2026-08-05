import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { mapBookingPayload } from "@/lib/bookingIntake/mapPayload";
import { applyPercentOff, resolvePromoCode } from "@/lib/bookingIntake/promoCodes";
import type { BookingIntakePayload } from "@/lib/bookingIntake/types";
import { upsertContact } from "@/lib/bookingIntake/upsertContact";
import { upsertVehicle } from "@/lib/bookingIntake/upsertVehicle";
import { createReminderJobsForBooking } from "@/lib/email/scheduledReminderJobs";
import { sendBookingConfirmationEmail } from "@/lib/email/sendBookingConfirmation";
import { sendTeamBookingNotification } from "@/lib/email/sendTeamBookingNotification";
import { cancelLeadJobs } from "@/lib/scheduling/leadJobs";
import { scheduleBookingReminderSms } from "@/lib/sms/scheduledSmsJobs";
import { loadAndRenderSms } from "@/lib/sms/smsTemplateRenderer";
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

  // Capture client IP + user-agent server-side (the client can't be trusted to
  // report its own IP). Stashed into raw_payload so the Meta Conversions API
  // upload can send them as match keys. The browser form supplies fbc/fbp
  // (from the _fbc/_fbp cookies) in the payload; those flow through rawPayload.
  try {
    const fwd = request.headers.get("x-forwarded-for");
    const clientIp = fwd ? fwd.split(",")[0].trim() : (request.headers.get("x-real-ip") ?? null);
    const clientUa = request.headers.get("user-agent") ?? null;
    const p = payload as Record<string, unknown>;
    if (clientIp && !p.client_ip_address) p.client_ip_address = clientIp;
    if (clientUa && !p.client_user_agent) p.client_user_agent = clientUa;
  } catch {
    /* never block a booking on attribution capture */
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

    // ── Promo code resolution (e.g. CCC5) ────────────────────────────────
    // Resolved server-side so the client can't fabricate a discount. Applies
    // percent-off to price_estimate, prepends a note to booking.notes, and
    // queues credit rows to insert after the booking has an id.
    const promo = resolvePromoCode(
      normalized.data.booking.promoCode,
      (shop as ShopRow).slug
    );
    const discountedPrice = promo
      ? applyPercentOff(normalized.data.booking.priceEstimate, promo.percentOff)
      : normalized.data.booking.priceEstimate;
    const notesWithPromo = promo
      ? [promo.noteForBooking, normalized.data.booking.notes].filter(Boolean).join("\n\n")
      : normalized.data.booking.notes;

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
        price_estimate: discountedPrice,
        notes: notesWithPromo,
        service_id: normalized.data.booking.serviceId,
        duration_minutes: normalized.data.booking.durationMinutes,
        location_type: normalized.data.booking.locationType,
        service_address: normalized.data.booking.serviceAddress,
        gclid: normalized.data.booking.gclid,
        gbraid: normalized.data.booking.gbraid,
        wbraid: normalized.data.booking.wbraid,
        landing_url: normalized.data.booking.landingUrl,
        raw_payload: normalized.data.booking.rawPayload
      })
      .select("*")
      .single();

    if (bookingError) {
      throw bookingError;
    }

    // Insert customer_credits rows for any "free future service" the promo
    // granted. Failures are non-fatal — the booking is already saved.
    if (promo && promo.credits.length > 0) {
      try {
        await supabase.from("customer_credits").insert(
          promo.credits.map((c) => ({
            shop_id: shop.id,
            contact_id: contact.id,
            credit_type: "free_service",
            service_name: c.serviceName,
            description: c.description,
            source: c.source,
            source_booking_id: booking.id,
          }))
        );
        console.info("Customer credits granted via promo", {
          bookingId: booking.id,
          contactId: contact.id,
          count: promo.credits.length,
        });
      } catch (creditErr) {
        console.error("customer_credits insert failed (non-fatal)", creditErr);
      }
    }

    if (existingLead) {
      // Attribute the conversion back to the original lead source.
      // - Booked via the instant on-page quote (deep-link carried src=quote,
      //   so booking_source='quote') → won_source='quote'
      // - Else if the lead received an auto-respond estimate (template_id) →
      //   'auto_email'
      // - Otherwise the customer booked without an estimate email →
      //   'direct_booking' (called, or lead still in 'new'/'needs_approval').
      const wonSource =
        normalized.data.booking.bookingSource === "quote"
          ? "quote"
          : existingLead.template_id
            ? "auto_email"
            : "direct_booking";

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
        "lead_followup_30day",
      ]);
    }

    // Close ANY *other* still-open leads for this contact. A contact can hold
    // more than one stale enquiry (e.g. a needs_approval lead that never got an
    // estimate), and getLatestOpenLeadForContact only returns the newest one.
    // Left open, those resurface in nurture/win-back sends after the customer
    // has already booked. existingLead is now 'won' so it's excluded here.
    const { data: siblingLeads } = await supabase
      .from("leads")
      .select("id")
      .eq("shop_id", shop.id)
      .eq("contact_id", contact.id)
      .in("status", OPEN_LEAD_STATUSES);
    if (siblingLeads && siblingLeads.length > 0) {
      const siblingIds = siblingLeads.map((l) => l.id as string);
      const { error: siblingErr } = await supabase
        .from("leads")
        .update({ status: "won", won_source: "direct_booking", booked_at: booking.created_at })
        .in("id", siblingIds);
      if (siblingErr) {
        console.error("Failed to close sibling open leads on booking", siblingErr);
      } else {
        for (const id of siblingIds) {
          await cancelLeadJobs(id, [
            "lead_auto_estimate",
            "lead_followup_3day",
            "lead_followup_7day",
            "lead_followup_30day",
          ]);
        }
      }
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

    // Schedule T-1day SMS reminder — only if we have a phone number
    if (contact.phone) {
      try {
        const smsFirstName =
          contact.first_name ?? contact.full_name?.split(" ")[0] ?? "there";
        await scheduleBookingReminderSms({
          bookingId: booking.id,
          contactId: contact.id,
          shopId: shop.id,
          phone: contact.phone,
          firstName: smsFirstName,
          scheduledStart: booking.scheduled_start,
          timezone: (shop as ShopRow).timezone,
        });
      } catch (smsReminderError) {
        console.error("Failed to schedule booking reminder SMS", smsReminderError);
      }
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
        const { body: smsMessage } = await loadAndRenderSms(shop.id, "booking_confirmation", {
          name: firstName,
          date_time: dateLabel,
        });
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
