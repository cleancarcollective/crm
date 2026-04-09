import type { ShopRecord } from "@/lib/dashboard/types";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { getShopContacts } from "@/lib/email/shopContacts";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type LeadDetails = {
  id: string;
  contact_id: string | null;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  service_requested: string | null;
  notes: string | null;
};

function getRequiredEnv(name: "POSTMARK_FROM_EMAIL") {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function infoRow(label: string, value: string | null) {
  if (!value) return "";
  return `
    <tr>
      <td style="padding: 11px 0; border-bottom: 1px solid #ede6dc;">
        <span style="display: block; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #9e9189; margin-bottom: 2px;">${escapeHtml(label)}</span>
        <span style="font-size: 15px; font-weight: 600; color: #1a1713;">${escapeHtml(value)}</span>
      </td>
    </tr>
  `;
}

function renderLeadNotificationHtml(shop: ShopRecord, lead: LeadDetails): string {
  const vehicleLabel = [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(" ") || null;

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>New Lead</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f0ebe4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f0ebe4; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;">

            <!-- Header -->
            <tr>
              <td style="background: linear-gradient(160deg, #1a1713 0%, #0d0c0b 100%); border-radius: 16px 16px 0 0; padding: 32px 36px;">
                <p style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #E5E4E2;">Clean Car Collective</p>
                <h1 style="margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; line-height: 1.15;">New Lead</h1>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="background: #ffffff; padding: 36px 36px 32px; border-left: 1px solid #e8e0d6; border-right: 1px solid #e8e0d6;">

                <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.65; color: #5c5148;">
                  A new enquiry has been submitted through the website for <strong style="color: #1a1713;">${escapeHtml(shop.name)}</strong>.
                </p>

                <!-- Contact details -->
                <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Contact</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-top: 1px solid #ede6dc;">
                  ${infoRow("Name", [lead.first_name, lead.last_name].filter(Boolean).join(" "))}
                  ${infoRow("Email", lead.email)}
                  ${infoRow("Phone", lead.phone)}
                </table>

                <!-- Enquiry details -->
                <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Enquiry</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-top: 1px solid #ede6dc;">
                  ${infoRow("Service interested in", lead.service_requested)}
                  ${infoRow("Vehicle", vehicleLabel)}
                </table>

                ${lead.notes ? `
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 28px; background: #f7f3ee; border-radius: 12px; border: 1px solid #e8e0d6;">
                  <tr>
                    <td style="padding: 18px 22px;">
                      <p style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Notes</p>
                      <p style="margin: 0; font-size: 14px; line-height: 1.65; color: #5c5148;">${escapeHtml(lead.notes)}</p>
                    </td>
                  </tr>
                </table>
                ` : ""}

                <p style="margin: 0; font-size: 14px; color: #9e9189;">Follow up via the CRM or reply directly to ${escapeHtml(lead.email)}.</p>

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background: #1a1713; border-radius: 0 0 16px 16px; padding: 22px 36px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td>
                      <p style="margin: 0 0 2px; font-size: 13px; font-weight: 600; color: #ffffff;">Clean Car Collective</p>
                      <p style="margin: 0; font-size: 12px; color: #7a6f68;">${escapeHtml(shop.name)}</p>
                    </td>
                    <td align="right" style="vertical-align: middle;">
                      <a href="${escapeHtml(getShopContacts(shop).website)}" style="font-size: 12px; color: #7a6f68; text-decoration: none;">${escapeHtml(getShopContacts(shop).website.replace("https://", ""))}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}

export async function sendLeadTeamNotification({
  shop,
  lead,
}: {
  shop: ShopRecord;
  lead: LeadDetails;
}) {
  const { team_email: recipient } = getShopContacts(shop);
  const from = getRequiredEnv("POSTMARK_FROM_EMAIL");

  const vehicleLabel = [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(" ");
  const subject = `New lead: ${lead.first_name}${lead.last_name ? " " + lead.last_name : ""}${lead.service_requested ? " — " + lead.service_requested : ""}${vehicleLabel ? " (" + vehicleLabel + ")" : ""}`;

  const textBody = [
    `New lead from ${shop.name}`,
    ``,
    `Name: ${[lead.first_name, lead.last_name].filter(Boolean).join(" ")}`,
    `Email: ${lead.email}`,
    lead.phone ? `Phone: ${lead.phone}` : null,
    vehicleLabel ? `Vehicle: ${vehicleLabel}` : null,
    lead.service_requested ? `Service: ${lead.service_requested}` : null,
    lead.notes ? `\nNotes: ${lead.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const supabase = getSupabaseAdminClient();

  // Record the outbound email
  const { data: messageRecord, error: insertError } = await supabase
    .from("email_messages")
    .insert({
      shop_id: shop.id,
      contact_id: lead.contact_id,
      lead_id: lead.id,
      booking_id: null,
      template_id: null,
      subject,
      body_rendered: renderLeadNotificationHtml(shop, lead),
      status: "queued",
    })
    .select("id")
    .single();

  if (insertError) throw insertError;

  try {
    const postmark = getPostmarkClient();
    const response = await postmark.sendEmail({
      From: from,
      To: recipient,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: renderLeadNotificationHtml(shop, lead),
      MessageStream: "booking-emails",
      Metadata: {
        email_message_id: messageRecord.id,
        shop_id: shop.id,
        lead_id: lead.id,
        template_key: "lead-team-notification",
      },
    });

    await supabase
      .from("email_messages")
      .update({ provider_message_id: response.MessageID, status: "sent", sent_at: new Date().toISOString() })
      .eq("id", messageRecord.id);

    console.info("Lead team notification sent", { leadId: lead.id, providerMessageId: response.MessageID });
  } catch (error) {
    await supabase.from("email_messages").update({ status: "failed" }).eq("id", messageRecord.id);
    console.error("Lead team notification failed", { leadId: lead.id, error });
    throw error;
  }
}
