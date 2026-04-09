/**
 * Pick-up ready notification emails.
 *
 * Two variants depending on time of day (NZ local time):
 *  - Before 4 pm  → standard "your vehicle is ready, please advise if >30 mins away"
 *  - From 4 pm    → after-hours variant: advises possible overnight storage if late
 */

import { formatInTimeZone } from "date-fns-tz";

import type { ShopRecord } from "@/lib/dashboard/types";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type PickupEmailArgs = {
  shop: ShopRecord;
  firstName: string;
  customerEmail: string;
  vehicleLabel: string | null;
  bookingId: string;
  contactId: string | null;
};

const SHOP_DETAILS: Record<string, { address: string; phone: string; email: string }> = {
  christchurch: {
    address: "20 Southwark Street, Christchurch Central, 8011",
    phone: "0800 476 667",
    email: "hello@cleancarcollective.co.nz",
  },
  wellington: {
    address: "8 Ebor Street, Te Aro, Wellington 6011",
    phone: "0800 476 667",
    email: "hello@cleancarcollective.co.nz",
  },
};

const DEFAULT_SHOP_DETAILS = {
  address: "New Zealand",
  phone: "0800 476 667",
  email: "hello@cleancarcollective.co.nz",
};

function escapeHtml(v: string) {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isAfterFourPm(shop: ShopRecord): boolean {
  const nowInShopTz = formatInTimeZone(new Date(), shop.timezone, "HH:mm");
  const [h, m] = nowInShopTz.split(":").map(Number);
  return h > 16 || (h === 16 && m >= 0);
}

function renderPickupHtml(args: PickupEmailArgs, afterHours: boolean, shopDetails: typeof DEFAULT_SHOP_DETAILS): string {
  const heading = afterHours ? "Your Vehicle is Ready" : "Your Vehicle is Ready for Pick-up";

  const bodyMessage = afterHours
    ? `Your ${args.vehicleLabel ? escapeHtml(args.vehicleLabel) : "vehicle"} has been freshly detailed and is ready for collection from <strong style="color:#1a1713;">${escapeHtml(args.shop.name)}</strong>.<br /><br />As we close at <strong>5:00 pm</strong>, if you think you'll be more than 30 minutes away please let us know your ETA so we can make sure someone is here — or arrange secure overnight storage for you.`
    : `Your ${args.vehicleLabel ? escapeHtml(args.vehicleLabel) : "vehicle"} has been freshly detailed and is ready for collection from <strong style="color:#1a1713;">${escapeHtml(args.shop.name)}</strong>.<br /><br />If you're going to be more than <strong>30 minutes away</strong>, please give us a heads-up so we can plan accordingly.`;

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f0ebe4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f0ebe4;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(160deg,#1a1713 0%,#0d0c0b 100%);border-radius:16px 16px 0 0;padding:32px 36px;">
              <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#E5E4E2;">Clean Car Collective</p>
              <h1 style="margin:0;font-size:26px;font-weight:700;color:#ffffff;line-height:1.15;">${escapeHtml(heading)}</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:36px 36px 32px;border-left:1px solid #e8e0d6;border-right:1px solid #e8e0d6;">
              <p style="margin:0 0 6px;font-size:17px;font-weight:600;color:#1a1713;">Hi ${escapeHtml(args.firstName)},</p>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.75;color:#5c5148;">${bodyMessage}</p>

              <!-- Address block -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;background:#f7f3ee;border-radius:12px;border:1px solid #e8e0d6;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#9e9189;">Pick-up address</p>
                    <p style="margin:0 0 6px;font-size:15px;font-weight:600;color:#1a1713;">${escapeHtml(shopDetails.address)}</p>
                    <p style="margin:0;font-size:14px;color:#5c5148;">
                      <a href="tel:${escapeHtml(shopDetails.phone.replaceAll(" ", ""))}" style="color:#1a1713;font-weight:600;text-decoration:none;">${escapeHtml(shopDetails.phone)}</a>
                      &nbsp;&middot;&nbsp;
                      <a href="mailto:${escapeHtml(shopDetails.email)}" style="color:#1a1713;text-decoration:none;">${escapeHtml(shopDetails.email)}</a>
                    </p>
                  </td>
                </tr>
              </table>

              ${afterHours ? `
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;background:#fff8e6;border-radius:12px;border:1px solid #f5d87a;">
                <tr>
                  <td style="padding:18px 22px;">
                    <p style="margin:0;font-size:14px;line-height:1.6;color:#7a5800;">⏰ <strong>After-hours note:</strong> We close at 5:00 pm. Please contact us if you need late pick-up arrangements.</p>
                  </td>
                </tr>
              </table>
              ` : ""}

              <p style="margin:0;font-size:14px;color:#9e9189;">We look forward to seeing you soon. Thanks for choosing Clean Car Collective!</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#1a1713;border-radius:0 0 16px 16px;padding:22px 36px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <p style="margin:0 0 2px;font-size:13px;font-weight:600;color:#ffffff;">Clean Car Collective</p>
                    <p style="margin:0;font-size:12px;color:#7a6f68;">${escapeHtml(args.shop.name)}</p>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <a href="https://cleancarcollective.co.nz" style="font-size:12px;color:#7a6f68;text-decoration:none;">cleancarcollective.co.nz</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td></tr>
    </table>
  </body>
</html>`.trim();
}

function renderPickupText(args: PickupEmailArgs, afterHours: boolean, shopDetails: typeof DEFAULT_SHOP_DETAILS): string {
  const vehicle = args.vehicleLabel ?? "your vehicle";
  if (afterHours) {
    return `Hi ${args.firstName},\n\nYour ${vehicle} is ready for pick-up at ${args.shop.name}.\n\nWe close at 5:00 pm — if you'll be more than 30 minutes away please let us know your ETA so we can arrange accordingly.\n\n${shopDetails.address}\n${shopDetails.phone}\n${shopDetails.email}\n\nThanks,\nClean Car Collective`;
  }
  return `Hi ${args.firstName},\n\nYour ${vehicle} is ready for pick-up at ${args.shop.name}.\n\nIf you'll be more than 30 minutes away, please let us know.\n\n${shopDetails.address}\n${shopDetails.phone}\n${shopDetails.email}\n\nThanks,\nClean Car Collective`;
}

export async function sendPickupReadyEmail(args: PickupEmailArgs): Promise<{ sent: boolean; afterHours: boolean }> {
  const fromEmail = process.env["POSTMARK_FROM_EMAIL"];
  if (!fromEmail) throw new Error("Missing POSTMARK_FROM_EMAIL");

  const shopDetails = SHOP_DETAILS[args.shop.slug] ?? DEFAULT_SHOP_DETAILS;
  const afterHours = isAfterFourPm(args.shop);

  const subject = afterHours
    ? `Your vehicle is ready — please advise if you'll be late`
    : `Your vehicle is ready for pick-up!`;

  const htmlBody = renderPickupHtml(args, afterHours, shopDetails);
  const textBody = renderPickupText(args, afterHours, shopDetails);

  const supabase = getSupabaseAdminClient();

  const { data: messageRecord, error: insertError } = await supabase
    .from("email_messages")
    .insert({
      shop_id: args.shop.id,
      contact_id: args.contactId,
      booking_id: args.bookingId,
      template_id: null,
      subject,
      body_rendered: htmlBody,
      status: "queued",
    })
    .select("id")
    .single();

  if (insertError) throw insertError;

  const postmark = getPostmarkClient();
  const response = await postmark.sendEmail({
    From: fromEmail,
    To: args.customerEmail,
    Subject: subject,
    TextBody: textBody,
    HtmlBody: htmlBody,
    MessageStream: "booking-emails",
    Metadata: {
      email_message_id: messageRecord.id,
      booking_id: args.bookingId,
      shop_id: args.shop.id,
      template_key: afterHours ? "pickup-ready-after-hours" : "pickup-ready",
    },
  });

  await supabase
    .from("email_messages")
    .update({ provider_message_id: response.MessageID, status: "sent", sent_at: new Date().toISOString() })
    .eq("id", messageRecord.id);

  console.info("Pickup ready email sent", { bookingId: args.bookingId, afterHours });
  return { sent: true, afterHours };
}
