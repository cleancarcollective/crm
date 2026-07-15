/**
 * POST /api/public/booking-action
 *
 * Token-authed customer-facing endpoint. Verifies the signed `manage_booking`
 * token, then either:
 *   - cancel: flips booking.status='cancelled', cancels reminder jobs, notifies team
 *   - reschedule: writes a "pending reschedule" note on the booking and notifies
 *     team. Doesn't actually move the booking - staff confirm + slot the new
 *     time via the CRM (which then triggers the standard booking_update email
 *     to the customer with the confirmed time).
 *
 * Team notifications are HTML with a one-click "Open in CRM" button so staff
 * can jump straight to the booking and approve, reschedule, or fully delete.
 */

import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { verifyActionToken } from "@/lib/auth/signedTokens";
import { cancelSeriesCore } from "@/lib/bookings/cancelSeries";
import {
  sendSeriesCancelCustomerEmail,
  sendSeriesCancelTeamNotification,
} from "@/lib/email/sendSeriesEditCancelEmails";
import { enqueueTeamNotification, notifyTeamReliable } from "@/lib/email/teamNotify";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type Body = {
  token?: string;
  action?: "cancel" | "reschedule";
  reason?: string | null;
  new_date?: string;
  new_time?: string;
  /**
   * For action='cancel' only. Defaults to 'one'. 'series' cancels the
   * whole recurring series - booking must have a series_id. Rejected for
   * reschedule (customers can't reschedule a series via the public form;
   * that's a phone call).
   */
  scope?: "one" | "series";
};

const CRM_BASE_URL = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.token || !body.action) {
    return NextResponse.json({ error: "Missing token or action" }, { status: 400 });
  }

  const verify = await verifyActionToken(body.token, {
    requireAction: "manage_booking",
    checkConsumed: false,
  });
  if (!verify.ok) {
    return NextResponse.json({ error: `Token: ${verify.reason}` }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, shop_id, series_id, service_name, scheduled_start, status, contact:contacts(first_name, last_name, email, phone)")
    .eq("id", verify.payload.r)
    .eq("shop_id", verify.payload.s)
    .maybeSingle();

  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (booking.status === "cancelled" || booking.status === "completed") {
    return NextResponse.json({ error: `Booking already ${booking.status}` }, { status: 400 });
  }

  const { data: shop } = await supabase
    .from("shops")
    .select("id, slug, name, timezone")
    .eq("id", booking.shop_id)
    .maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop missing" }, { status: 500 });

  const contact = booking.contact as unknown as { first_name: string; last_name: string | null; email: string; phone: string | null } | null;
  const customerName = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") : "Customer";

  if (body.action === "cancel") {
    // Whole-series cancel - only valid when the booking is part of a series.
    if (body.scope === "series") {
      if (!booking.series_id) {
        return NextResponse.json(
          { error: "This booking is not part of a recurring series." },
          { status: 400 }
        );
      }
      const result = await cancelSeriesCore({
        seriesId: booking.series_id as string,
        shopId: booking.shop_id,
        reason: body.reason ?? null,
        actor: "customer",
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }

      // Emails - non-fatal.
      try {
        await sendSeriesCancelCustomerEmail({
          shopId: booking.shop_id,
          seriesId: booking.series_id as string,
          serviceName: result.series.service_name,
          remainingCancelled: result.bookingsCancelled,
          reason: body.reason ?? null,
          customerEmail: result.contact?.email ?? null,
          customerFirstName: result.contact?.firstName ?? null,
        });
      } catch (err) {
        console.error("Self-service series cancel customer email failed", err);
      }
      try {
        await sendSeriesCancelTeamNotification({
          shopId: booking.shop_id,
          seriesId: booking.series_id as string,
          serviceName: result.series.service_name,
          remainingCancelled: result.bookingsCancelled,
          reason: body.reason ?? null,
          customerName: result.contact?.fullName ?? null,
          customerEmail: result.contact?.email ?? null,
        });
      } catch (err) {
        console.error("Self-service series cancel team notification failed — enqueueing fallback", err);
        try {
          await enqueueTeamNotification(supabase, {
            shopId: booking.shop_id,
            bookingId: booking.id,
            payload: {
              kind: "cancel",
              subject: `❌ Recurring series cancelled by customer: ${customerName}`,
              lines: [
                `${customerName} cancelled their recurring ${result.series.service_name} series via the self-service link.`,
                `Bookings cancelled: ${result.bookingsCancelled}`,
                body.reason ? `Reason: ${body.reason}` : "(no reason given)",
              ],
            },
          });
        } catch (queueErr) {
          console.error("Series-cancel notification TOTAL failure", queueErr);
        }
      }

      return NextResponse.json({ ok: true, bookingsCancelled: result.bookingsCancelled });
    }

    // Single-booking cancel (default).
    // Flip booking status - auto-zeros price via the DB trigger and gets
    // filtered out of the calendar by the cancelled-status query filter.
    await supabase
      .from("bookings")
      .update({ status: "cancelled", notes: appendNote(null, body.reason ? `Customer cancelled via self-service: ${body.reason}` : "Customer cancelled via self-service") })
      .eq("id", booking.id)
      .eq("shop_id", booking.shop_id);

    // Cancel pending reminders (email + SMS)
    await supabase
      .from("scheduled_email_jobs")
      .update({ status: "cancelled", last_error: "Booking cancelled by customer" })
      .eq("booking_id", booking.id)
      .eq("status", "pending");
    await supabase
      .from("scheduled_sms_jobs")
      .update({ status: "cancelled", last_error: "Booking cancelled by customer" })
      .eq("booking_id", booking.id)
      .eq("status", "pending");

    await notifyTeamReliable(supabase, {
      shop: { id: shop.id, slug: shop.slug, name: shop.name, timezone: shop.timezone },
      bookingId: booking.id,
      kind: "cancel",
      subject: `❌ Booking cancelled by customer: ${customerName}`,
      lines: [
        `${customerName} cancelled their ${booking.service_name} booking via the self-service link.`,
        `Original time: ${formatBookingTime(booking.scheduled_start, shop.timezone)}`,
        body.reason ? `Reason: ${body.reason}` : "(no reason given)",
        `Email: ${contact?.email ?? "-"}`,
        `Phone: ${contact?.phone ?? "-"}`,
        ``,
        `The slot has been cancelled in the CRM and removed from the calendar. Pending reminders have been cancelled.`,
      ],
    });

    return NextResponse.json({ ok: true });
  }

  // Reschedule - series-scope not supported via self-service. Reschedule
  // a whole series is a cadence change, which requires staff to cancel +
  // recreate the series.
  if (body.scope === "series") {
    return NextResponse.json(
      { error: "Reschedule a recurring series isn't available here - please call us or reply to the email." },
      { status: 400 }
    );
  }
  if (!body.new_date || !body.new_time) {
    return NextResponse.json({ error: "Missing new_date or new_time" }, { status: 400 });
  }

  const requestedIsoLabel = `${body.new_date} ${body.new_time}`;
  const noteLine = `[Reschedule requested] Customer prefers: ${requestedIsoLabel}${body.reason ? ` - ${body.reason}` : ""}`;

  const { data: existing } = await supabase
    .from("bookings")
    .select("notes")
    .eq("id", booking.id)
    .maybeSingle();

  await supabase
    .from("bookings")
    .update({ notes: appendNote(existing?.notes ?? null, noteLine) })
    .eq("id", booking.id)
    .eq("shop_id", booking.shop_id);

  await notifyTeamReliable(supabase, {
    shop: { id: shop.id, slug: shop.slug, name: shop.name, timezone: shop.timezone },
    bookingId: booking.id,
    kind: "reschedule",
    subject: `🔄 Reschedule requested: ${customerName}`,
    lines: [
      `${customerName} requested a reschedule via the self-service link.`,
      `Original time: ${formatBookingTime(booking.scheduled_start, shop.timezone)}`,
      `Requested time: ${requestedIsoLabel}`,
      body.reason ? `Note: ${body.reason}` : "",
      `Email: ${contact?.email ?? "-"}`,
      `Phone: ${contact?.phone ?? "-"}`,
      ``,
      `Open the booking in the CRM to confirm the new time. Once you save the updated slot, the standard booking-update email will fire automatically.`,
    ].filter(Boolean),
  });

  return NextResponse.json({ ok: true });
}

function appendNote(existing: string | null, line: string): string {
  if (!existing) return line;
  return `${existing}\n${line}`;
}

function formatBookingTime(iso: string, tz: string): string {
  return formatInTimeZone(iso, tz, "EEE d MMM yyyy 'at' h:mm a");
}


