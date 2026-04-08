import type { ShopRecord } from "@/lib/dashboard/types";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type LeadConfirmationArgs = {
  shop: ShopRecord;
  firstName: string;
  email: string;
  vehicleLabel: string | null;
  serviceRequested: string | null;
  leadId: string;
};

const SHOP_DETAILS: Record<string, { phone: string; replyEmail: string }> = {
  christchurch: { phone: "0800 476 667", replyEmail: "hello@cleancarcollective.co.nz" },
  wellington: { phone: "0800 476 667", replyEmail: "hello@cleancarcollective.co.nz" },
};

const DEFAULT_SHOP_DETAILS = { phone: "0800 476 667", replyEmail: "hello@cleancarcollective.co.nz" };

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function detailRow(label: string, value: string | null): string {
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

function renderHtml(args: LeadConfirmationArgs, shopDetails: { phone: string; replyEmail: string }): string {
  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>We've received your enquiry</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f0ebe4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f0ebe4; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;">

            <!-- Header -->
            <tr>
              <td style="background: linear-gradient(160deg, #1a1713 0%, #0d0c0b 100%); border-radius: 16px 16px 0 0; padding: 32px 36px;">
                <p style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #E5E4E2;">Clean Car Collective</p>
                <h1 style="margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; line-height: 1.15;">We've Got Your Enquiry</h1>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="background: #ffffff; padding: 36px 36px 32px; border-left: 1px solid #e8e0d6; border-right: 1px solid #e8e0d6;">

                <p style="margin: 0 0 6px; font-size: 17px; font-weight: 600; color: #1a1713;">Hi ${escapeHtml(args.firstName)},</p>
                <p style="margin: 0 0 28px; font-size: 15px; line-height: 1.65; color: #5c5148;">
                  Thanks for reaching out to ${escapeHtml(args.shop.name)}. We've received your enquiry and one of our team will be in touch shortly with a quote.
                </p>

                <!-- Enquiry summary -->
                <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Your enquiry</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 28px; border-top: 1px solid #ede6dc;">
                  ${detailRow("Service", args.serviceRequested)}
                  ${detailRow("Vehicle", args.vehicleLabel)}
                </table>

                <!-- Contact block -->
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 28px; background: #f7f3ee; border-radius: 12px; border: 1px solid #e8e0d6;">
                  <tr>
                    <td style="padding: 20px 24px;">
                      <p style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Need to talk to us?</p>
                      <p style="margin: 0 0 4px; font-size: 15px; font-weight: 600; color: #1a1713;">${escapeHtml(shopDetails.phone)}</p>
                      <p style="margin: 0;">
                        <a href="mailto:${escapeHtml(shopDetails.replyEmail)}" style="font-size: 14px; color: #5c5148; text-decoration: underline;">${escapeHtml(shopDetails.replyEmail)}</a>
                      </p>
                    </td>
                  </tr>
                </table>

                <p style="margin: 0; font-size: 14px; line-height: 1.65; color: #9e9189;">
                  In the meantime, feel free to browse our services at
                  <a href="https://cleancarcollective.co.nz" style="color: #5c5148;">cleancarcollective.co.nz</a>.
                </p>

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background: #1a1713; border-radius: 0 0 16px 16px; padding: 22px 36px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td>
                      <p style="margin: 0 0 2px; font-size: 13px; font-weight: 600; color: #ffffff;">Clean Car Collective</p>
                      <p style="margin: 0; font-size: 12px; color: #7a6f68;">${escapeHtml(args.shop.name)}</p>
                    </td>
                    <td align="right" style="vertical-align: middle;">
                      <a href="https://cleancarcollective.co.nz" style="font-size: 12px; color: #7a6f68; text-decoration: none;">cleancarcollective.co.nz</a>
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

function renderText(args: LeadConfirmationArgs, shopDetails: { phone: string; replyEmail: string }): string {
  const lines = [
    `Hi ${args.firstName},`,
    ``,
    `Thanks for reaching out to ${args.shop.name}. We've received your enquiry and one of our team will be in touch shortly with a quote.`,
    ``,
    `YOUR ENQUIRY`,
  ];
  if (args.serviceRequested) lines.push(`Service: ${args.serviceRequested}`);
  if (args.vehicleLabel) lines.push(`Vehicle: ${args.vehicleLabel}`);
  lines.push(
    ``,
    `Questions? Contact us:`,
    shopDetails.phone,
    shopDetails.replyEmail,
    ``,
    `Clean Car Collective — ${args.shop.name}`,
    `cleancarcollective.co.nz`,
  );
  return lines.join("\n");
}

export async function sendLeadConfirmationEmail(args: LeadConfirmationArgs): Promise<void> {
  const fromEmail = process.env["POSTMARK_FROM_EMAIL"];
  if (!fromEmail) throw new Error("Missing POSTMARK_FROM_EMAIL");

  const shopDetails = SHOP_DETAILS[args.shop.slug] ?? DEFAULT_SHOP_DETAILS;

  const subject = `We've received your enquiry — Clean Car Collective`;
  const htmlBody = renderHtml(args, shopDetails);
  const textBody = renderText(args, shopDetails);

  const supabase = getSupabaseAdminClient();

  const { data: messageRecord, error: insertError } = await supabase
    .from("email_messages")
    .insert({
      shop_id: args.shop.id,
      contact_id: null,
      booking_id: null,
      template_id: null,
      subject,
      body_rendered: htmlBody,
      status: "queued",
    })
    .select("id")
    .single();

  if (insertError) throw insertError;

  try {
    const postmark = getPostmarkClient();
    const response = await postmark.sendEmail({
      From: fromEmail,
      To: args.email,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
      MessageStream: "booking-emails",
      Metadata: {
        email_message_id: messageRecord.id,
        shop_id: args.shop.id,
        lead_id: args.leadId,
        template_key: "lead-confirmation",
      },
    });

    await supabase
      .from("email_messages")
      .update({
        provider_message_id: response.MessageID,
        status: "sent",
        sent_at: new Date().toISOString(),
      })
      .eq("id", messageRecord.id);

    console.info("Lead confirmation email sent", { leadId: args.leadId, email: args.email });
  } catch (error) {
    await supabase.from("email_messages").update({ status: "failed" }).eq("id", messageRecord.id);
    console.error("Lead confirmation email failed", { leadId: args.leadId, error });
    throw error;
  }
}
