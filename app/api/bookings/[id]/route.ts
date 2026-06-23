import { addMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getBookingWithRelationsById, getShopById } from "@/lib/dashboard/bookings";
import { createReminderJobsForBooking } from "@/lib/email/scheduledReminderJobs";
import { sendBookingUpdateEmail } from "@/lib/email/sendBookingUpdateEmail";
import { scheduleBookingReminderSms } from "@/lib/sms/scheduledSmsJobs";
import { schedulePostDetailTouchpoints } from "@/lib/bookings/postDetailTouchpoints";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type BookingUpdatePayload = {
  service_name?: string;
  status?: string;
  scheduled_start?: string;
  duration_minutes?: number | null;
  price_estimate?: number | null;
  location_type?: string | null;
  service_address?: string | null;
  notes?: string | null;
  send_update_email?: boolean;
};

function formatCurrency(value: number | null) {
  if (value === null) return null;
  return `${new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(value)} +GST`;
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
    service_address: payload.service_address !== undefined ? payload.service_address : existingBooking.service_address,
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

  // TERMINAL STATUS: if the booking just flipped to cancelled / completed
  // / no_show, proactively cancel pending booking-reminder jobs so the
  // queue is clean. The workers also have a status guard at send-time as
  // a safety net, but cancelling at write-time keeps the audit trail
  // tidy and removes one class of "queue still says pending" confusion.
  const TERMINAL_STATUSES = new Set(["cancelled", "completed", "no_show"]);
  if (
    TERMINAL_STATUSES.has(booking.status) &&
    !TERMINAL_STATUSES.has(existingBooking.status)
  ) {
    try {
      await supabase
        .from("scheduled_email_jobs")
        .update({ status: "cancelled", last_error: `Booking status -> ${booking.status}` })
        .eq("booking_id", booking.id)
        .eq("status", "pending")
        .is("job_type", null);
      await supabase
        .from("scheduled_sms_jobs")
        .update({ status: "cancelled", last_error: `Booking status -> ${booking.status}` })
        .eq("booking_id", booking.id)
        .eq("status", "pending")
        .is("template_key", null);
    } catch (err) {
      console.error("Failed to cancel reminders after status change", { bookingId: booking.id, err });
    }
  }

  // RESCHEDULE: if scheduled_start changed, the existing pending reminder
  // jobs (email + SMS) are now wrong on two axes:
  //   1. Their scheduled_for is relative to the OLD start (so a
  //      "day-before" reminder fires 24h before the wrong date).
  //   2. SMS reminders have the original date pre-rendered into the
  //      `message` column at schedule-time, so even if they fired at the
  //      right time they'd quote the wrong date.
  // Cancel the old jobs and re-create them via the same helpers so the
  // customer gets fresh, accurate reminders for the new slot.
  if (
    booking.status !== "cancelled" &&
    booking.status !== "completed" &&
    existingBooking.scheduled_start !== booking.scheduled_start
  ) {
    try {
      await supabase
        .from("scheduled_email_jobs")
        .update({ status: "cancelled", last_error: "Rescheduled - rebuilding reminders" })
        .eq("booking_id", booking.id)
        .eq("status", "pending")
        .is("job_type", null);

      await supabase
        .from("scheduled_sms_jobs")
        .update({ status: "cancelled", last_error: "Rescheduled - rebuilding reminders" })
        .eq("booking_id", booking.id)
        .eq("status", "pending");

      const shopForReminders = await getShopById(booking.shop_id);
      await createReminderJobsForBooking({
        shop: shopForReminders,
        bookingId: booking.id,
        contactId: booking.contact_id,
        scheduledStart: booking.scheduled_start,
      });

      // SMS reminder needs the contact phone + first name.
      if (booking.contact_id) {
        const { data: contact } = await supabase
          .from("contacts")
          .select("phone, first_name, full_name")
          .eq("id", booking.contact_id)
          .maybeSingle();
        if (contact?.phone) {
          await scheduleBookingReminderSms({
            bookingId: booking.id,
            contactId: booking.contact_id,
            shopId: booking.shop_id,
            phone: contact.phone as string,
            firstName: (contact.first_name as string | null) ?? (contact.full_name as string | null)?.split(" ")[0] ?? "there",
            scheduledStart: booking.scheduled_start,
            timezone: shopForReminders.timezone,
          });
        }
      }
    } catch (err) {
      // Non-fatal - the booking update still succeeded. Reminders just
      // didn't get rebuilt; staff can re-send manually if needed.
      console.error("Failed to rebuild reminders after reschedule", { bookingId: booking.id, err });
    }
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
