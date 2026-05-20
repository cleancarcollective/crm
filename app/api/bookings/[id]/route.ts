import { addMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getBookingWithRelationsById, getShopById } from "@/lib/dashboard/bookings";
import { sendBookingUpdateEmail } from "@/lib/email/sendBookingUpdateEmail";
import { schedulePostDetailTouchpoints } from "@/lib/bookings/postDetailTouchpoints";
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

  const currentShop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();
  const { data: existingBooking, error: fetchError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .eq("shop_id", currentShop.id)
    .single();

  if (fetchError || !existingBooking) {
    return NextResponse.json({ success: false, error: "Booking not found." }, { status: 404 });
  }

  const scheduledStart = payload.scheduled_start ?? existingBooking.scheduled_start;
  const durationMinutes = payload.duration_minutes ?? existingBooking.duration_minutes;
  const updateData: Record<string, unknown> = {
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

  // "Just this one" semantics for recurring series: a per-booking edit
  // (incl. a cancel via status='cancelled') protects this occurrence from
  // future series-wide overwrites.
  if (existingBooking.series_id) {
    updateData.series_overridden = true;
  }

  const { data: booking, error: updateError } = await supabase
    .from("bookings")
    .update(updateData)
    .eq("id", id)
    .eq("shop_id", currentShop.id)
    .select("*")
    .single();

  if (updateError) {
    return NextResponse.json({ success: false, error: "Failed to update booking." }, { status: 500 });
  }

  // Trigger post-detail recurring-discount touchpoints when staff flips
  // the booking to 'completed' for the first time. Non-fatal — log on
  // error, never block the PATCH response.
  if (booking.status === "completed" && existingBooking.status !== "completed") {
    try {
      const result = await schedulePostDetailTouchpoints(booking.id);
      console.info("Post-detail touchpoints schedule attempt", {
        bookingId: booking.id,
        scheduled: result.scheduled,
        skipped: result.skipped,
      });
    } catch (err) {
      console.error("Failed to schedule post-detail touchpoints", { bookingId: booking.id, err });
    }
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
  const currentShop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();

  const { error, count } = await supabase
    .from("bookings")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("shop_id", currentShop.id);

  if (error) {
    return NextResponse.json({ success: false, error: "Failed to delete booking." }, { status: 500 });
  }
  if ((count ?? 0) === 0) {
    return NextResponse.json({ success: false, error: "Booking not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
