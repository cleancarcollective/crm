/**
 * POST /api/public/booking-action
 *
 * Token-authed customer-facing endpoint. Verifies the signed `manage_booking`
 * token, then either:
 *   - cancel: flips booking.status='cancelled', cancels reminder jobs, notifies team
 *   - reschedule: writes a "pending reschedule" note on the booking and notifies
 *     team. Doesn't actually move the booking — staff confirm + slot the new
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
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import {
  sendSeriesCancelCustomerEmail,
  sendSeriesCancelTeamNotification,
} from "@/lib/email/sendSeriesEditCancelEmails";
import { getShopContacts } from "@/lib/email/shopContacts";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type Body = {
  token?: string;
  action?: "cancel" | "reschedule";
  reason?: string | null;
  new_date?: string;
  new_time?: string;
  /**
   * For action='cancel' only. Defaults to 'one'. 'series' cancels the
   * whole recurring series — booking must have a series_id. Rejected for
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
    // Whole-series cancel — only valid when the booking is part of a series.
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

      // Emails — non-fatal.
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
        console.error("Self-service series cancel team notification failed", err);
      }

      return NextResponse.json({ ok: true, bookingsCancelled: result.bookingsCancelled });
    }

    // Single-booking cancel (default).
    // Flip booking status — auto-zeros price via the DB trigger and gets
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

    try {
      await notifyTeam({
        shop: { id: shop.id, slug: shop.slug, name: shop.name, timezone: shop.timezone },
        bookingId: booking.id,
        kind: "cancel",
        subject: `❌ Booking cancelled by customer: ${customerName}`,
        lines: [
          `${customerName} cancelled their ${booking.service_name} booking via the self-service link.`,
          `Original time: ${formatBookingTime(booking.scheduled_start, shop.timezone)}`,
          body.reason ? `Reason: ${body.reason}` : "(no reason given)",
          `Email: ${contact?.email ?? "—"}`,
          `Phone: ${contact?.phone ?? "—"}`,
          ``,
          `The slot has been cancelled in the CRM and removed from the calendar. Pending reminders have been cancelled.`,
        ],
      });
    } catch (err) {
      console.error("Cancel team-notification failed", err);
    }

    return NextResponse.json({ ok: true });
  }

  // Reschedule — series-scope not supported via self-service. Reschedule
  // a whole series is a cadence change, which requires staff to cancel +
  // recreate the series.
  if (body.scope === "series") {
    return NextResponse.json(
      { error: "Reschedule a recurring series isn't available here — please call us or reply to the email." },
      { status: 400 }
    );
  }
  if (!body.new_date || !body.new_time) {
    return NextResponse.json({ error: "Missing new_date or new_time" }, { status: 400 });
  }

  const requestedIsoLabel = `${body.new_date} ${body.new_time}`;
  const noteLine = `[Reschedule requested] Customer prefers: ${requestedIsoLabel}${body.reason ? ` — ${body.reason}` : ""}`;

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

  try {
    await notifyTeam({
      shop: { id: shop.id, slug: shop.slug, name: shop.name, timezone: shop.timezone },
      bookingId: booking.id,
      kind: "reschedule",
      subject: `🔄 Reschedule requested: ${customerName}`,
      lines: [
        `${customerName} requested a reschedule via the self-service link.`,
        `Original time: ${formatBookingTime(booking.scheduled_start, shop.timezone)}`,
        `Requested time: ${requestedIsoLabel}`,
        body.reason ? `Note: ${body.reason}` : "",
        `Email: ${contact?.email ?? "—"}`,
        `Phone: ${contact?.phone ?? "—"}`,
        ``,
        `Open the booking in the CRM to confirm the new time. Once you save the updated slot, the standard booking-update email will fire automatically.`,
      ].filter(Boolean),
    });
  } catch (err) {
    console.error("Reschedule team-notification failed", err);
  }

  return NextResponse.json({ ok: true });
}

function appendNote(existing: string | null, line: string): string {
  if (!existing) return line;
  return `${existing}\n${line}`;
}

function formatBookingTime(iso: string, tz: string): string {
  return formatInTimeZone(iso, tz, "EEE d MMM yyyy 'at' h:mm a");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function notifyTeam(args: {
  shop: { id: string; slug: string; name: string; timezone: string };
  bookingId: string;
  kind: "cancel" | "reschedule";
  subject: string;
  lines: string[];
}) {
  const { team_email, from_line: from } = getShopContacts(args.shop);
  const crmUrl = `${CRM_BASE_URL}/bookings/${args.bookingId}`;
  const ctaLabel = args.kind === "cancel" ? "View cancelled booking in CRM →" : "Open booking & confirm new time →";

  // Plain text body — Postmark requires this even when HtmlBody is set,
  // and some inboxes still prefer the text version.
  const textBody = [...args.lines, "", `Open in CRM: ${crmUrl}`].join("\n");

  // HTML body — same lines as plain text plus a styled CTA button so staff
  // can jump straight to the booking. Layout mirrors the other internal
  // notification emails (daily-digest, approval-pending, etc.).
  const accent = args.kind === "cancel" ? "#c0392b" : "#1a4d2e";
  const htmlBody = `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#E5E4E2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#E5E4E2;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;">
          <tr>
            <td style="background:#1a1713;padding:28px 32px;border-radius:16px 16px 0 0;">
              <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#c9c5c0;">${escapeHtml(args.shop.name)}</p>
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.2;">${escapeHtml(args.subject)}</h1>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:28px 32px;border-left:1px solid #e8e0d6;border-right:1px solid #e8e0d6;">
              ${args.lines
                .map((line) => line.trim().length === 0
                  ? `<div style="height:8px;"></div>`
                  : `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#1a1713;">${escapeHtml(line)}</p>`
                ).join("\n")}
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0 4px;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(crmUrl)}" style="display:inline-block;padding:13px 28px;background:${accent};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;">
                      ${escapeHtml(ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#1a1713;padding:18px 32px;border-radius:0 0 16px 16px;">
              <p style="margin:0;font-size:12px;color:#7a6f68;">${escapeHtml(args.shop.name)} CRM — sent automatically by the customer-action handler</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
  `.trim();

  const postmark = getPostmarkClient();
  await postmark.sendEmail({
    From: from,
    To: team_email,
    Subject: args.subject,
    TextBody: textBody,
    HtmlBody: htmlBody,
    MessageStream: "booking-emails",
    TrackOpens: false,
    TrackLinks: "None" as never,
    Metadata: {
      shop_id: args.shop.id,
      booking_id: args.bookingId,
      template_key: `booking_action_${args.kind}`,
    },
  });
}
