import { addMinutes } from "date-fns";
import { NextResponse } from "next/server";

import { getShopBySlug } from "@/lib/dashboard/bookings";
import { createReminderJobsForBooking } from "@/lib/email/scheduledReminderJobs";
import { sendBookingConfirmationEmail } from "@/lib/email/sendBookingConfirmation";
import { sendTeamBookingNotification } from "@/lib/email/sendTeamBookingNotification";
import { sendTnzSms } from "@/lib/sms/tnzClient";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { formatInTimeZone } from "date-fns-tz";

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
  notes?: string;
  status?: string;
  // Notifications
  send_confirmation_email?: boolean;
  send_confirmation_sms?: boolean;
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
  const shop = await getShopBySlug();

  // ── 1. Resolve contact ──────────────────────────────────────────────
  let contactId: string;
  let contactPhone: string | null = null;
  let contactFirstName: string | null = null;

  if (payload.contact_id) {
    contactId = payload.contact_id;
    // Fetch phone for SMS
    const { data: ct } = await supabase
      .from("contacts")
      .select("phone, first_name, full_name")
      .eq("id", contactId)
      .single();
    contactPhone = ct?.phone ?? null;
    contactFirstName = ct?.first_name ?? ct?.full_name?.split(" ")[0] ?? null;
  } else {
    const nc = payload.new_contact!;
    const fullName = [nc.first_name, nc.last_name].filter(Boolean).join(" ") || null;
    const { data: created, error } = await supabase
      .from("contacts")
      .insert({
        shop_id: shop.id,
        first_name: nc.first_name ?? null,
        last_name: nc.last_name ?? null,
        full_name: fullName,
        email: nc.email?.toLowerCase().trim() || null,
        phone: nc.phone?.trim() || null,
      })
      .select("id, phone, first_name")
      .single();

    if (error || !created) {
      return NextResponse.json({ success: false, error: "Failed to create contact." }, { status: 500 });
    }
    contactId = created.id;
    contactPhone = created.phone ?? null;
    contactFirstName = created.first_name ?? null;
  }

  // ── 2. Resolve vehicle (optional) ───────────────────────────────────
  let vehicleId: string | null = null;

  if (payload.vehicle_id) {
    vehicleId = payload.vehicle_id;
  } else if (payload.new_vehicle && Object.values(payload.new_vehicle).some(Boolean)) {
    const nv = payload.new_vehicle;
    const { data: created, error } = await supabase
      .from("vehicles")
      .insert({
        shop_id: shop.id,
        contact_id: contactId,
        make: nv.make ?? null,
        model: nv.model ?? null,
        year: nv.year ?? null,
        rego: nv.rego ?? null,
        size: nv.size ?? null,
      })
      .select("id")
      .single();

    if (error || !created) {
      return NextResponse.json({ success: false, error: "Failed to create vehicle." }, { status: 500 });
    }
    vehicleId = created.id;
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

  // ── 4. Reminder jobs ─────────────────────────────────────────────────
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

  // ── 5. Confirmation email ─────────────────────────────────────────────
  if (payload.send_confirmation_email !== false) {
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
  if (payload.send_confirmation_sms !== false && contactPhone) {
    try {
      const firstName = contactFirstName ?? "there";
      const dateLabel = formatInTimeZone(booking.scheduled_start, shop.timezone, "EEE d MMM 'at' h:mm a");
      const smsMessage = `Hi ${firstName}, your booking is confirmed for ${dateLabel}. See you soon! - Clean Car Collective`;
      await sendTnzSms(contactPhone, smsMessage);
    } catch (err) {
      console.error("Confirmation SMS failed", err);
    }
  }

  return NextResponse.json({ success: true, booking_id: booking.id });
}
