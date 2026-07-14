/**
 * "Your photos are ready" email - fires automatically on the first
 * photo batch for a booking. Doubles as the portal-acquisition nudge:
 * the photos live in the customer's account, so every detail becomes
 * a signup prompt.
 */

import { formatInTimeZone } from "date-fns-tz";

import { EMAIL_HEAD_HARDENING } from "@/lib/email/sharedEmailStyles";
import { sendViaGmailSmtp } from "@/lib/email/smtpClient";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const CRM_BASE_URL = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";
const PORTAL_FROM = "Clean Car Collective <hello@cleancarcollective.co.nz>";
const LOGO_URL = `${CRM_BASE_URL}/images/ccc-logo-white.png`;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Send the photos-ready email for a booking. Returns true if sent. */
export async function sendDetailPhotosEmail(args: { bookingId: string }): Promise<boolean> {
  const supabase = getSupabaseAdminClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, shop_id, contact_id, service_name, scheduled_start")
    .eq("id", args.bookingId)
    .maybeSingle();
  if (!booking?.contact_id) return false;

  const [{ data: contact }, { data: shop }, { data: photos }] = await Promise.all([
    supabase.from("contacts").select("id, first_name, email").eq("id", booking.contact_id).single(),
    supabase.from("shops").select("id, slug, name, timezone").eq("id", booking.shop_id).single(),
    supabase
      .from("detail_photos")
      .select("public_url")
      .eq("booking_id", args.bookingId)
      .order("created_at", { ascending: true })
      .limit(3),
  ]);
  if (!contact?.email || !shop || !photos || photos.length === 0) return false;

  const greeting = contact.first_name ? `Hi ${escapeHtml(contact.first_name)},` : "Hi,";
  const dateLabel = formatInTimeZone(booking.scheduled_start, shop.timezone, "EEEE d MMMM");
  const subject = `📸 Your ${booking.service_name} photos are in`;

  const photoCells = photos
    .map(
      (p) => `<td style="padding:3px;" width="${Math.floor(100 / photos.length)}%">
        <img src="${escapeHtml(p.public_url)}" width="100%" style="display:block;border-radius:10px;" alt="Your detail" />
      </td>`
    )
    .join("");

  const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your detail photos</title>
    ${EMAIL_HEAD_HARDENING}
  </head>
  <body style="margin:0;padding:0;background-color:#E5E4E2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#E5E4E2;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;">
          <tr>
            <td bgcolor="#1a1713" align="center" style="background-color:#1a1713;border-radius:16px 16px 0 0;padding:26px 34px;">
              <img src="${escapeHtml(LOGO_URL)}" width="56" alt="Clean Car Collective" style="display:block;margin:0 auto 10px;" />
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.2;">Fresh off the ${escapeHtml(booking.service_name)}</h1>
              <p style="margin:6px 0 0;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#c9c5c0;">${escapeHtml(dateLabel)} · ${escapeHtml(shop.name.replace("Clean Car Collective ", ""))}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:26px 30px;border-left:1px solid #e8e0d6;border-right:1px solid #e8e0d6;">
              <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#5c5148;">${greeting}<br/>
              The team snapped these while working on your car - the full set is waiting in your account.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:18px;"><tr>${photoCells}</tr></table>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:14px;">
                <tr><td align="center">
                  <a href="${escapeHtml(`${CRM_BASE_URL}/account`)}" style="display:inline-block;padding:14px 36px;background:#1a1713;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:12px;">See all my photos</a>
                </td></tr>
              </table>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#9e9189;">No password needed - enter your email on the sign-in page and we'll send you a one-tap link. Your bookings, vehicles and photos all live there.</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="#1a1713" style="background-color:#1a1713;border-radius:0 0 16px 16px;padding:18px 34px;">
              <p style="margin:0;font-size:12px;color:#7a6f68;">Clean Car Collective · cleancarcollective.co.nz</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`.trim();

  const text = `${contact.first_name ? `Hi ${contact.first_name},` : "Hi,"}

The team snapped photos while working on your car (${booking.service_name}, ${dateLabel}). The full set is in your account:

${CRM_BASE_URL}/account

No password needed - enter your email on the sign-in page and we'll send a one-tap link.`;

  const { data: messageRecord } = await supabase
    .from("email_messages")
    .insert({
      shop_id: booking.shop_id,
      contact_id: contact.id,
      lead_id: null,
      booking_id: booking.id,
      template_id: null,
      subject,
      body_rendered: html,
      status: "queued",
    })
    .select("id")
    .single();

  try {
    const res = await sendViaGmailSmtp({
      From: PORTAL_FROM,
      To: contact.email,
      Subject: subject,
      TextBody: text,
      HtmlBody: html,
      Metadata: { template_key: "detail-photos-ready", booking_id: booking.id },
    });
    if (messageRecord) {
      await supabase
        .from("email_messages")
        .update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: res.MessageID ?? null })
        .eq("id", messageRecord.id);
    }
    return true;
  } catch (err) {
    if (messageRecord) {
      await supabase.from("email_messages").update({ status: "failed" }).eq("id", messageRecord.id);
    }
    throw err;
  }
}
