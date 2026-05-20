/**
 * Approval request email - sent to the team when auto-respond has built a
 * draft estimate but the lead requires human review before sending.
 *
 * Contains:
 *   - Customer + vehicle summary
 *   - Plain-English explanation of why approval is needed
 *   - Draft estimate preview (subject + body)
 *   - Big "Review & Send in CRM" button linking to the contact profile
 */

import type { ShopRecord } from "@/lib/dashboard/types";
import { signActionToken } from "@/lib/auth/signedTokens";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { EMAIL_HEAD_HARDENING } from "@/lib/email/sharedEmailStyles";
import { getShopContacts } from "@/lib/email/shopContacts";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const CRM_BASE_URL = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";

export type ApprovalReason =
  | "notes_present"
  | "vehicle_size_unknown"
  | "low_confidence"
  | "draft_error"
  | "send_failed"
  | "other";

type ApprovalRequestArgs = {
  shop: ShopRecord;
  leadId: string;
  contactId: string | null;
  customer: {
    firstName: string;
    lastName: string | null;
    email: string;
    phone: string | null;
  };
  vehicle: {
    year: string | null;
    make: string | null;
    model: string | null;
  };
  serviceRequested: string | null;
  customerNotes: string | null;
  reason: ApprovalReason;
  reasonDetail: string | null;
  estimate: {
    subject: string;
    body: string;
  };
};


function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Turn the internal reason code into a plain-English explanation. */
function explainReason(reason: ApprovalReason, detail: string | null): string {
  switch (reason) {
    case "notes_present":
      return "The customer added notes that may need a personal response - please read them before sending the estimate.";
    case "vehicle_size_unknown":
      return "We couldn't match their vehicle model to our size database. Please confirm the correct vehicle size so pricing is accurate.";
    case "low_confidence":
      return "We couldn't match the vehicle to our size database with high confidence. Please verify the vehicle size before sending.";
    case "draft_error":
      return `There was a problem building the estimate - please review and complete it manually.${detail ? ` Details: ${detail}` : ""}`;
    case "send_failed":
      return `The auto-send attempt failed. Please review and try again.${detail ? ` Details: ${detail}` : ""}`;
    case "other":
    default:
      return detail ?? "This lead needs manual review before the estimate can be sent.";
  }
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

function renderApprovalHtml(args: ApprovalRequestArgs, reviewUrl: string, quickSendUrl: string | null): string {
  const { shop, customer, vehicle, serviceRequested, customerNotes, reason, reasonDetail, estimate } = args;
  const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || null;
  const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(" ");
  const reasonText = explainReason(reason, reasonDetail);

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Action needed - Review estimate</title>
    ${EMAIL_HEAD_HARDENING}
  </head>
  <body style="margin: 0; padding: 0; background-color: #E5E4E2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #E5E4E2; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 640px;">

            <!-- Header with amber accent bar to signal attention -->
            <tr>
              <td bgcolor="#1a1713" class="email-header email-pad-x" style="background-color: #1a1713; background-image: linear-gradient(160deg, #1a1713 0%, #0d0c0b 100%); border-radius: 16px 16px 0 0; padding: 32px 36px; border-top: 4px solid #f4b942;">
                <p class="email-header-eyebrow" style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #f4b942;">Action needed</p>
                <h1 class="email-header-title" style="margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; line-height: 1.15;">Review estimate for ${escapeHtml(customer.firstName)}</h1>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="background: #ffffff; padding: 36px 36px 28px; border-left: 1px solid #e8e0d6; border-right: 1px solid #e8e0d6;">

                <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.65; color: #5c5148;">
                  Auto-respond has drafted an estimate but it needs your review before sending.
                </p>

                <!-- Why -->
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 28px; background: #fff8e6; border-left: 3px solid #f4b942; border-radius: 6px;">
                  <tr>
                    <td style="padding: 14px 18px;">
                      <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #a37400;">Why it needs approval</p>
                      <p style="margin: 0; font-size: 14px; line-height: 1.55; color: #1a1713;">${escapeHtml(reasonText)}</p>
                    </td>
                  </tr>
                </table>

                <!-- Contact -->
                <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Contact</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-top: 1px solid #ede6dc;">
                  ${infoRow("Name", fullName || null)}
                  ${infoRow("Email", customer.email)}
                  ${infoRow("Phone", customer.phone)}
                </table>

                <!-- Enquiry -->
                <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Enquiry</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-top: 1px solid #ede6dc;">
                  ${infoRow("Service interested in", serviceRequested)}
                  ${infoRow("Vehicle", vehicleLabel)}
                </table>

                ${customerNotes ? `
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; background: #f7f3ee; border-radius: 12px; border: 1px solid #e8e0d6;">
                  <tr>
                    <td style="padding: 16px 20px;">
                      <p style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Customer notes</p>
                      <p style="margin: 0; font-size: 14px; line-height: 1.65; color: #5c5148; white-space: pre-wrap;">${escapeHtml(customerNotes)}</p>
                    </td>
                  </tr>
                </table>
                ` : ""}

                <!-- Action buttons: quick-send (one-click) + review-in-CRM -->
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 28px 0 24px;">
                  <tr>
                    <td align="center">
                      ${quickSendUrl ? `
                        <a href="${escapeHtml(quickSendUrl)}" style="display: inline-block; padding: 16px 36px; background: #2c7d2c; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 10px; letter-spacing: 0.02em; margin-right: 8px;">
                          ✅ Send draft as-is
                        </a>
                      ` : ""}
                      <a href="${escapeHtml(reviewUrl)}" style="display: inline-block; padding: 16px 30px; background: #1a1713; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 10px; letter-spacing: 0.02em;">
                        Review &amp; edit in CRM →
                      </a>
                    </td>
                  </tr>
                </table>
                ${quickSendUrl ? `
                <p style="margin: 0 0 24px; font-size: 12px; color: #9e9189; text-align: center;">
                  &ldquo;Send draft as-is&rdquo; sends the exact draft below - no edits, no review. Use it when the draft looks good. Link expires in 7 days, single-use.
                </p>
                ` : ""}

                <!-- Draft preview -->
                <p style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Draft estimate</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 8px; background: #fafaf8; border: 1px solid #e8e0d6; border-radius: 12px;">
                  <tr>
                    <td style="padding: 18px 22px 8px;">
                      <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #9e9189;">Subject</p>
                      <p style="margin: 0 0 14px; font-size: 14px; font-weight: 600; color: #1a1713;">${escapeHtml(estimate.subject)}</p>
                      <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #9e9189;">Body</p>
                      <pre style="margin: 0; padding: 12px 14px; background: #ffffff; border: 1px solid #ede6dc; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.55; color: #1a1713; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(estimate.body)}</pre>
                    </td>
                  </tr>
                </table>

                <p style="margin: 18px 0 0; font-size: 13px; color: #9e9189;">You can edit the subject and body before sending in the CRM.</p>

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td bgcolor="#1a1713" class="email-footer email-pad-x" style="background-color: #1a1713; border-radius: 0 0 16px 16px; padding: 22px 36px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td>
                      <p class="email-footer-title" style="margin: 0 0 2px; font-size: 13px; font-weight: 600; color: #ffffff;">Clean Car Collective CRM</p>
                      <p class="email-footer-sub" style="margin: 0; font-size: 12px; color: #7a6f68;">${escapeHtml(shop.name)}</p>
                    </td>
                    <td align="right" style="vertical-align: middle;">
                      <a href="${escapeHtml(reviewUrl)}" style="font-size: 12px; color: #f4b942; text-decoration: none; font-weight: 600;">Open lead →</a>
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

function renderApprovalText(args: ApprovalRequestArgs, reviewUrl: string, quickSendUrl: string | null): string {
  const { shop, customer, vehicle, serviceRequested, customerNotes, reason, reasonDetail, estimate } = args;
  const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "-";
  const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.firstName;
  const reasonText = explainReason(reason, reasonDetail);

  return [
    `ACTION NEEDED: Review estimate for ${fullName}`,
    `Shop: ${shop.name}`,
    ``,
    `Why it needs approval:`,
    reasonText,
    ``,
    `---`,
    `Contact`,
    `  Name: ${fullName}`,
    `  Email: ${customer.email}`,
    customer.phone ? `  Phone: ${customer.phone}` : null,
    ``,
    `Enquiry`,
    `  Service: ${serviceRequested ?? "-"}`,
    `  Vehicle: ${vehicleLabel}`,
    customerNotes ? `\nCustomer notes:\n${customerNotes}` : null,
    ``,
    quickSendUrl ? `Send the draft as-is (1 click): ${quickSendUrl}` : null,
    `Review & edit in CRM: ${reviewUrl}`,
    ``,
    `---`,
    `Draft estimate`,
    ``,
    `Subject: ${estimate.subject}`,
    ``,
    estimate.body,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export async function sendApprovalRequestEmail(args: ApprovalRequestArgs): Promise<void> {
  const { shop, leadId, contactId, customer } = args;
  const { team_email: recipient, from_line: from } = getShopContacts(shop);

  // The review URL - contact profile is where the estimate panel lives.
  // If no contactId (shouldn't happen in practice), fall back to /leads.
  const reviewUrl = contactId
    ? `${CRM_BASE_URL}/contacts/${contactId}`
    : `${CRM_BASE_URL}/leads`;

  // One-click "Send as-is" link - only mint a token if the env var is set
  // (it'll throw otherwise). When ACTION_TOKEN_SECRET isn't set the email
  // still goes out without the quick-send button - graceful degradation.
  let quickSendUrl: string | null = null;
  try {
    if (process.env.ACTION_TOKEN_SECRET) {
      const token = signActionToken({ a: "lead_send_estimate", r: leadId, s: shop.id });
      quickSendUrl = `${CRM_BASE_URL}/api/leads/${leadId}/quick-send?token=${encodeURIComponent(token)}`;
    }
  } catch (err) {
    console.warn("Quick-send token mint failed; falling back to review-only", err);
  }

  const vehicleLabel = [args.vehicle.year, args.vehicle.make, args.vehicle.model].filter(Boolean).join(" ");
  const subjectParts = [
    "🔔 Action needed:",
    `Review estimate for ${customer.firstName}`,
    args.serviceRequested ? `- ${args.serviceRequested}` : "",
    vehicleLabel ? `(${vehicleLabel})` : "",
  ].filter(Boolean);
  const subject = subjectParts.join(" ");

  const htmlBody = renderApprovalHtml(args, reviewUrl, quickSendUrl);
  const textBody = renderApprovalText(args, reviewUrl, quickSendUrl);

  const supabase = getSupabaseAdminClient();

  const { data: messageRecord, error: insertError } = await supabase
    .from("email_messages")
    .insert({
      shop_id: shop.id,
      contact_id: contactId,
      lead_id: leadId,
      booking_id: null,
      template_id: null,
      subject,
      body_rendered: htmlBody,
      status: "queued",
    })
    .select("id")
    .single();

  if (insertError || !messageRecord) {
    throw new Error(`approval email_messages insert failed: ${insertError?.message ?? "no row"}`);
  }

  try {
    const postmark = getPostmarkClient();
    const response = await postmark.sendEmail({
      From: from,
      To: recipient,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
      MessageStream: "booking-emails",
      // Internal notification - don't track clicks (no customer intent signal).
      TrackOpens: false,
      TrackLinks: "None" as never,
      Metadata: {
        email_message_id: messageRecord.id,
        shop_id: shop.id,
        lead_id: leadId,
        template_key: "lead-approval-request",
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

    console.info("Approval request email sent", { leadId, providerMessageId: response.MessageID });
  } catch (error) {
    await supabase.from("email_messages").update({ status: "failed" }).eq("id", messageRecord.id);
    console.error("Approval request email failed", { leadId, error });
    throw error;
  }
}
