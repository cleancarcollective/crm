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
 */

import { NextResponse } from "next/server";

import { consumeActionToken, verifyActionToken } from "@/lib/auth/signedTokens";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { getShopContacts } from "@/lib/email/shopContacts";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type Body = {
  token?: string;
  action?: "cancel" | "reschedule";
  reason?: string | null;
  new_date?: string;
  new_time?: string;
};

function getRequiredEnv(name: "POSTMARK_FROM_EMAIL") {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

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
    checkConsumed: false, // these tokens stay valid for multiple actions until expiry; we don't single-use them
  });
  if (!verify.ok) {
    return NextResponse.json({ error: `Token: ${verify.reason}` }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, shop_id, service_name, scheduled_start, status, contact:contacts(first_name, last_name, email, phone)")
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
    // Flip booking status
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

    // Notify the team
    try {
      await notifyTeam({
        shop: { id: shop.id, slug: shop.slug, name: shop.name, timezone: shop.timezone },
        subject: `❌ Booking cancelled by customer: ${customerName}`,
        bodyLines: [
          `${customerName} cancelled their ${booking.service_name} booking via the self-service link.`,
          `Original time: ${new Date(booking.scheduled_start).toISOString()}`,
          body.reason ? `Reason: ${body.reason}` : "(no reason given)",
          `Email: ${contact?.email ?? "—"}`,
          `Phone: ${contact?.phone ?? "—"}`,
        ],
      });
    } catch (err) {
      console.error("Cancel team-notification failed", err);
    }

    return NextResponse.json({ ok: true });
  }

  // Reschedule
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
      subject: `🔄 Reschedule requested: ${customerName}`,
      bodyLines: [
        `${customerName} requested a reschedule via the self-service link.`,
        `Original time: ${booking.scheduled_start}`,
        `Requested time: ${requestedIsoLabel}`,
        body.reason ? `Note: ${body.reason}` : "",
        `Email: ${contact?.email ?? "—"}`,
        `Phone: ${contact?.phone ?? "—"}`,
        ``,
        `Open the booking in the CRM to confirm the new time — once you save, the standard booking-update email will fire automatically.`,
      ].filter(Boolean),
    });
  } catch (err) {
    console.error("Reschedule team-notification failed", err);
  }

  // Don't consume the token — customer might come back to cancel after a reschedule

  return NextResponse.json({ ok: true });
}

function appendNote(existing: string | null, line: string): string {
  if (!existing) return line;
  return `${existing}\n${line}`;
}

async function notifyTeam(args: {
  shop: { id: string; slug: string; name: string; timezone: string };
  subject: string;
  bodyLines: string[];
}) {
  const { team_email } = getShopContacts(args.shop);
  const from = getRequiredEnv("POSTMARK_FROM_EMAIL");
  const postmark = getPostmarkClient();
  await postmark.sendEmail({
    From: from,
    To: team_email,
    Subject: args.subject,
    TextBody: args.bodyLines.join("\n"),
    MessageStream: "booking-emails",
    TrackOpens: false,
    TrackLinks: "None" as never,
  });
}
