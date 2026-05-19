import { addMinutes } from "date-fns";
import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { resolveContactAndVehicle } from "@/lib/bookings/resolveContactAndVehicle";
import { createReminderJobsForBooking } from "@/lib/email/scheduledReminderJobs";
import { sendBookingConfirmationEmail } from "@/lib/email/sendBookingConfirmation";
import { sendTeamBookingNotification } from "@/lib/email/sendTeamBookingNotification";
import { cancelLeadJobs } from "@/lib/scheduling/leadJobs";
import { scheduleBookingReminderSms } from "@/lib/sms/scheduledSmsJobs";
import { loadAndRenderSms } from "@/lib/sms/smsTemplateRenderer";
import { sendTnzSms } from "@/lib/sms/tnzClient";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { formatInTimeZone } from "date-fns-tz";

const OPEN_LEAD_STATUSES = [
  "new",
  "contacted",
  "quoted",
  "clicked",
  "sent",
  "needs_approval",
  "scheduled",
];

type NewContact = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
};

type NewVehicle = {
  make?: string;
  model?: string;
  year?: string;
  rego?: string;
  size?: string;
};

type ManualBookingPayload = {
  // Contact — either existing or new
  contact_id?: string;
  new_contact?: NewContact;
  // Vehicle — either existing or new (optional)
  vehicle_id?: string;
  new_vehicle?: NewVehicle;
  // Booking fields
  service_name: string;
  scheduled_start: string;   // ISO
  duration_minutes?: number;
  price_estimate?: number;
  location_type?: string;
  /** Customer service address — only meaningful for mobile bookings. */
  service_address?: string;
  notes?: string;
  status?: string;
  // Notifications
  send_confirmation_email?: boolean;
  send_confirmation_sms?: boolean;
  /**
   * Silent migration mode — used when staff is bulk-importing historical
   * bookings from another CRM (e.g. Orbis). When true, every notification
   * for this booking is suppressed: no customer email, no customer SMS,
   * no team notification, no scheduled email/SMS reminders.
   */
  silent_migration?: boolean;
};

export async function POST(request: Request) {
  let payload: ManualBookingPayload;
  try {
    payload = (await request.json()) as ManualBookingPayload;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON." }, { status: 400 });
  }

  if (!payload.service_name?.trim()) {
    return NextResponse.json({ success: false, error: "service_name is required." }, { status: 400 });
  }
  if (!payload.scheduled_start) {
    return NextResponse.json({ success: false, error: "scheduled_start is required." }, { status: 400 });
  }
  if (!payload.contact_id && !payload.new_contact) {
    return NextResponse.json({ success: false, error: "contact_id or new_contact is required." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const shop = await requireCurrentShop();

  // ── 1+2. Resolve contact + vehicle ──────────────────────────────────
  // Shared helper — keeps dedupe rules identical with /api/booking-series.
  let contactId: string;
  let contactPhone: string | null;
  let contactFirstName: string | null;
  let vehicleId: string | null;
  try {
    const resolved = await resolveContactAndVehicle({
      shopId: shop.id,
      contactId: payload.contact_id ?? null,
      newContact: payload.new_contact ?? null,
      vehicleId: payload.vehicle_id ?? null,
      newVehicle: payload.new_vehicle ?? null,
    });
    contactId = resolved.contactId;
    contactPhone = resolved.contactPhone;
    contactFirstName = resolved.contactFirstName;
    vehicleId = resolved.vehicleId;
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to resolve contact/vehicle." },
      { status: 500 }
    );
  }

  // ── 3. Create booking ────────────────────────────────────────────────
  const scheduledStart = payload.scheduled_start;
  const durationMinutes = payload.duration_minutes ?? null;
  const scheduledEnd = scheduledStart && durationMinutes
    ? addMinutes(new Date(scheduledStart), durationMinutes).toISOString()
    : null;

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert({
      shop_id: shop.id,
      contact_id: contactId,
      vehicle_id: vehicleId,
      booking_source: "manual",
      service_name: payload.service_name.trim(),
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      duration_minutes: durationMinutes,
      price_estimate: payload.price_estimate ?? null,
      location_type: payload.location_type ?? null,
      service_address: payload.service_address?.trim() || null,
      notes: payload.notes ?? null,
      status: payload.status ?? "confirmed",
      raw_payload: {},
    })
    .select("*")
    .single();

  if (bookingError || !booking) {
    console.error("Manual booking insert failed", bookingError);
    return NextResponse.json({ success: false, error: "Failed to create booking." }, { status: 500 });
  }

  // ── 3b. Attribute to an open lead (if any) and cancel follow-ups ─────
  // This is the same logic as /api/bookings/intake, so manually-created
  // bookings (phone, walk-in, etc.) still close the loop on the lead
  // funnel. Otherwise the customer would keep getting follow-up emails
  // after they've already booked.
  try {
    const { data: openLead } = await supabase
      .from("leads")
      .select("id, template_id")
      .eq("shop_id", shop.id)
      .eq("contact_id", contactId)
      .in("status", OPEN_LEAD_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openLead) {
      const wonSource = openLead.template_id ? "auto_email" : "direct_booking";
      await supabase
        .from("leads")
        .update({
          status: "won",
          won_source: wonSource,
          booked_at: booking.created_at,
          vehicle_id: vehicleId,
        })
        .eq("id", openLead.id);

      await cancelLeadJobs(openLead.id, [
        "lead_auto_estimate",
        "lead_followup_3day",
        "lead_followup_7day",
        "lead_followup_30day",
      ]);
    }
  } catch (err) {
    console.error("Manual booking lead attribution failed (non-fatal)", err);
  }

  // ── 4. Reminder jobs (email + SMS) ───────────────────────────────────
  // Skip entirely in silent-migration mode: imported historical bookings
  // shouldn't trigger week/day/hour reminders.
  if (!payload.silent_migration) {
    try {
      await createReminderJobsForBooking({
        shop,
        bookingId: booking.id,
        contactId,
        scheduledStart: booking.scheduled_start,
      });
    } catch (err) {
      console.error("Failed to schedule reminder jobs", err);
    }

    if (contactPhone) {
      try {
        await scheduleBookingReminderSms({
          bookingId: booking.id,
          contactId,
          shopId: shop.id,
          phone: contactPhone,
          firstName: contactFirstName ?? "there",
          scheduledStart: booking.scheduled_start,
          timezone: shop.timezone,
        });
      } catch (err) {
        console.error("Failed to schedule booking reminder SMS", err);
      }
    }
  }

  // ── 5. Confirmation email ─────────────────────────────────────────────
  if (!payload.silent_migration && payload.send_confirmation_email !== false) {
    try {
      const { data: contact } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, full_name, email, phone")
        .eq("id", contactId)
        .single();

      const { data: vehicle } = vehicleId
        ? await supabase.from("vehicles").select("id, make, model, year, rego, size").eq("id", vehicleId).single()
        : { data: null };

      if (contact?.email) {
        await sendBookingConfirmationEmail({
          shop,
          booking: { ...booking, contact, vehicle: vehicle ?? null },
        });
      }

      await sendTeamBookingNotification({
        shop,
        booking: { ...booking, contact, vehicle: vehicle ?? null },
      });
    } catch (err) {
      console.error("Confirmation email failed", err);
    }
  }

  // ── 6. Confirmation SMS ───────────────────────────────────────────────
  if (!payload.silent_migration && payload.send_confirmation_sms !== false && contactPhone) {
    try {
      const firstName = contactFirstName ?? "there";
      const dateLabel = formatInTimeZone(booking.scheduled_start, shop.timezone, "EEE d MMM 'at' h:mm a");
      const { body: smsMessage } = await loadAndRenderSms(shop.id, "booking_confirmation", {
        name: firstName,
        date_time: dateLabel,
      });
      await sendTnzSms(contactPhone, smsMessage);
    } catch (err) {
      console.error("Confirmation SMS failed", err);
    }
  }

  return NextResponse.json({ success: true, booking_id: booking.id });
}
