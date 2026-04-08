import { addMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { getBookingWithRelationsById, getShopById } from "@/lib/dashboard/bookings";
import { sendBookingUpdateEmail } from "@/lib/email/sendBookingUpdateEmail";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type BookingUpdatePayload = {
  service_name?: string;
  status?: string;
  scheduled_start?: string;
  duration_minutes?: number | null;
  price_estimate?: number | null;
  location_type?: string | null;
  notes?: string | null;
  send_update_email?: boolean;
};

function formatCurrency(value: number | null) {
  return value === null ? null : new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(value);
}

function buildChangeSummary(
  before: {
    service_name: string;
    scheduled_start: string;
    duration_minutes: number | null;
    price_estimate: number | null;
    location_type: string | null;
    notes: string | null;
  },
  after: {
    service_name: string;
    scheduled_start: string;
    duration_minutes: number | null;
    price_estimate: number | null;
    location_type: string | null;
    notes: string | null;
  },
  timezone: string
) {
  const changes: string[] = [];

  if (before.service_name !== after.service_name) {
    changes.push(`Service: ${before.service_name} -> ${after.service_name}`);
  }

  if (before.scheduled_start !== after.scheduled_start) {
    changes.push(
      `Date/time: ${formatInTimeZone(before.scheduled_start, timezone, "EEE d MMM yyyy, h:mm a")} -> ${formatInTimeZone(after.scheduled_start, timezone, "EEE d MMM yyyy, h:mm a")}`
    );
  }

  if (before.duration_minutes !== after.duration_minutes) {
    changes.push(`Duration: ${before.duration_minutes ?? "—"} min -> ${after.duration_minutes ?? "—"} min`);
  }

  if (before.price_estimate !== after.price_estimate) {
    changes.push(`Price: ${formatCurrency(before.price_estimate) ?? "—"} -> ${formatCurrency(after.price_estimate) ?? "—"}`);
  }

  if ((before.location_type ?? "") !== (after.location_type ?? "")) {
    changes.push(`Location: ${before.location_type ?? "—"} -> ${after.location_type ?? "—"}`);
  }

  if ((before.notes ?? "") !== (after.notes ?? "")) {
    changes.push("Notes were updated.");
  }

  return changes.join("\n");
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let payload: BookingUpdatePayload;

  try {
    payload = (await request.json()) as BookingUpdatePayload;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: existingBooking, error: fetchError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !existingBooking) {
    return NextResponse.json({ success: false, error: "Booking not found." }, { status: 404 });
  }

  const scheduledStart = payload.scheduled_start ?? existingBooking.scheduled_start;
  const durationMinutes = payload.duration_minutes ?? existingBooking.duration_minutes;
  const updateData = {
    service_name: payload.service_name ?? existingBooking.service_name,
    status: payload.status ?? existingBooking.status,
    scheduled_start: scheduledStart,
    scheduled_end:
      scheduledStart && durationMinutes
        ? addMinutes(new Date(scheduledStart), durationMinutes).toISOString()
        : null,
    duration_minutes: durationMinutes,
    price_estimate: payload.price_estimate ?? existingBooking.price_estimate,
    location_type: payload.location_type ?? existingBooking.location_type,
    notes: payload.notes ?? existingBooking.notes
  };

  const { data: booking, error: updateError } = await supabase
    .from("bookings")
    .update(updateData)
    .eq("id", id)
    .select("*")
    .single();

  if (updateError) {
    return NextResponse.json({ success: false, error: "Failed to update booking." }, { status: 500 });
  }

  let updateEmailStatus: "not_requested" | "sent" | "skipped" | "failed" = "not_requested";

  if (payload.send_update_email) {
    try {
      const shop = await getShopById(existingBooking.shop_id);
      const bookingWithRelations = await getBookingWithRelationsById(booking.id, existingBooking.shop_id);

      if (!bookingWithRelations) {
        throw new Error("Updated booking not found after save.");
      }

      const changeSummary = buildChangeSummary(
        {
          service_name: existingBooking.service_name,
          scheduled_start: existingBooking.scheduled_start,
          duration_minutes: existingBooking.duration_minutes,
          price_estimate: existingBooking.price_estimate,
          location_type: existingBooking.location_type,
          notes: existingBooking.notes,
        },
        {
          service_name: booking.service_name,
          scheduled_start: booking.scheduled_start,
          duration_minutes: booking.duration_minutes,
          price_estimate: booking.price_estimate,
          location_type: booking.location_type,
          notes: booking.notes,
        },
        shop.timezone
      );

      if (!changeSummary) {
        updateEmailStatus = "skipped";
      } else {
        const result = await sendBookingUpdateEmail({
          shop,
          booking: bookingWithRelations,
          changeSummary,
        });
        updateEmailStatus = result.skipped ? "skipped" : "sent";
      }
    } catch (error) {
      console.error("Booking update email failed", { bookingId: booking.id, error });
      updateEmailStatus = "failed";
    }
  }

  return NextResponse.json({ success: true, booking, update_email_status: updateEmailStatus });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase.from("bookings").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ success: false, error: "Failed to delete booking." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
