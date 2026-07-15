/**
 * POST /api/portal/bookings/[id]/request-change
 * Body: { kind: "reschedule" | "cancel", preferred?: string, note?: string }
 *
 * Session-cookie authed. Reschedule writes a "[Reschedule requested]"
 * note on the booking + notifies the shop team (staff confirm in CRM -
 * same flow as the tokened self-service link). Cancel requests are also
 * routed through staff rather than hard-cancelling: portal customers
 * may cancel well in advance, but the team wants a chance to rebook
 * the slot / talk retention.
 */

import { NextRequest, NextResponse } from "next/server";
import { formatInTimeZone } from "date-fns-tz";

import { getShopContacts } from "@/lib/email/shopContacts";
import { sendViaGmailSmtp } from "@/lib/email/smtpClient";
import { getPortalContacts, getPortalSession } from "@/lib/portal/session";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  let body: { kind?: string; preferred?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const kind = body.kind === "cancel" ? "cancel" : "reschedule";
  const preferred = (body.preferred ?? "").slice(0, 200);
  const note = (body.note ?? "").slice(0, 500);

  const supabase = getSupabaseAdminClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, shop_id, contact_id, service_name, scheduled_start, status, notes")
    .eq("id", id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  // Ownership: the booking's contact must belong to the session email.
  const contacts = await getPortalContacts(session.email);
  const owner = contacts.find((c) => c.id === booking.contact_id);
  if (!owner) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  if (["cancelled", "completed", "no_show"].includes(booking.status)) {
    return NextResponse.json({ error: "This booking can no longer be changed" }, { status: 400 });
  }

  const { data: shop } = await supabase
    .from("shops")
    .select("id, slug, name, timezone")
    .eq("id", booking.shop_id)
    .single();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 500 });

  const stamp = formatInTimeZone(new Date(), shop.timezone, "d MMM h:mm a");
  const label = kind === "cancel" ? "[Cancel requested]" : "[Reschedule requested]";
  const detail = [preferred ? `Customer prefers: ${preferred}` : null, note ? `Note: ${note}` : null]
    .filter(Boolean)
    .join(" - ");
  const noteLine = `${label} via account portal ${stamp}${detail ? ` - ${detail}` : ""}`;

  await supabase
    .from("bookings")
    .update({
      notes: booking.notes ? `${booking.notes}\n${noteLine}` : noteLine,
      // The booking stays confirmed until staff action it, but a pending
      // cancel must silence the countdown reminders. Cleared when staff
      // set a status (see the booking PATCH route).
      ...(kind === "cancel" ? { cancel_requested_at: new Date().toISOString() } : {}),
    })
    .eq("id", booking.id);

  // Kill queued reminders now, so we never send "see you in a week" /
  // "your booking is tomorrow" for a booking they asked to cancel.
  if (kind === "cancel") {
    const reason = "Cancel requested by customer via portal";
    await Promise.all([
      supabase
        .from("scheduled_email_jobs")
        .update({ status: "cancelled", last_error: reason })
        .eq("booking_id", booking.id)
        .eq("status", "pending"),
      supabase
        .from("scheduled_sms_jobs")
        .update({ status: "cancelled", last_error: reason })
        .eq("booking_id", booking.id)
        .eq("status", "pending"),
    ]);
  }

  // Notify the shop team.
  const customerName = owner.full_name || [owner.first_name, owner.last_name].filter(Boolean).join(" ") || session.email;
  const { team_email, from_line } = getShopContacts(shop);
  const when = formatInTimeZone(booking.scheduled_start, shop.timezone, "EEE d MMM yyyy 'at' h:mm a");
  const lines = [
    `${customerName} requested a ${kind === "cancel" ? "cancellation" : "reschedule"} from their account portal.`,
    `Booking: ${booking.service_name} - ${when}`,
    preferred ? `Preferred new time: ${preferred}` : null,
    note ? `Note: ${note}` : null,
    `Email: ${session.email}`,
    owner.phone ? `Phone: ${owner.phone}` : null,
    ``,
    `Open the booking in the CRM to action it.`,
  ].filter(Boolean) as string[];

  try {
    await sendViaGmailSmtp({
      From: from_line,
      To: team_email,
      Subject: `${kind === "cancel" ? "❌ Cancel" : "🔄 Reschedule"} requested (portal): ${customerName}`,
      TextBody: lines.join("\n"),
      HtmlBody: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;white-space:pre-wrap;">${lines
        .map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;"))
        .join("\n")}</div>`,
      Metadata: { template_key: "portal-change-request", booking_id: booking.id },
    });
  } catch (err) {
    console.error("Portal change-request team notification failed", err);
  }

  return NextResponse.json({ ok: true });
}
