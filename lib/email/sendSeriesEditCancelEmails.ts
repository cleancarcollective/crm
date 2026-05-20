/**
 * Inline-HTML emails for staff-driven series edits + cancellations (step 3).
 *
 * Three helpers:
 *   - sendSeriesEditTeamNotification: team-only summary of what changed.
 *   - sendSeriesCancelCustomerEmail:  customer-facing "your recurring X is
 *                                     cancelled" via Gmail SMTP (Primary tab).
 *   - sendSeriesCancelTeamNotification: team mirror via Postmark.
 *
 * Mirrors the pattern in sendSeriesConfirmation.ts - inline HTML, not a
 * template_id, because copy is unlikely to change often and adding it to
 * email_templates would require a per-shop seed migration.
 */

import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { getShopContacts, getShopContactsById } from "@/lib/email/shopContacts";
import { sendViaGmailSmtp } from "@/lib/email/smtpClient";
import { getShopById } from "@/lib/dashboard/bookings";

const CRM_BASE_URL = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ── Series edit team notification ────────────────────────────────────────

export async function sendSeriesEditTeamNotification(args: {
  shopId: string;
  seriesId: string;
  serviceName: string;
  bookingsUpdated: number;
  changeLines: string[];
}) {
  const { team_email, from_line } = await getShopContactsById(args.shopId);
  const subject = `Recurring series updated: ${args.serviceName}`;
  const crmUrl = `${CRM_BASE_URL}/series/${args.seriesId}`;

  const lines = [
    `A staff member updated the recurring series "${args.serviceName}".`,
    `${args.bookingsUpdated} future booking${args.bookingsUpdated === 1 ? "" : "s"} were updated to match.`,
    "",
    "Changes:",
    ...(args.changeLines.length > 0 ? args.changeLines.map((l) => `  • ${l}`) : ["  (no field-level diff captured)"]),
    "",
    "Customers were NOT emailed - they'll see the new details on their next reminder.",
  ];

  const textBody = [...lines, "", `Open in CRM: ${crmUrl}`].join("\n");
  const htmlBody = buildHtml({
    shopName: "CRM",
    subject,
    accent: "#1a4d2e",
    lines,
    ctaUrl: crmUrl,
    ctaLabel: "Open series in CRM →",
  });

  await getPostmarkClient().sendEmail({
    From: from_line,
    To: team_email,
    Subject: subject,
    TextBody: textBody,
    HtmlBody: htmlBody,
    MessageStream: "booking-emails",
    TrackOpens: false,
    TrackLinks: "None" as never,
    Metadata: {
      shop_id: args.shopId,
      series_id: args.seriesId,
      template_key: "booking_series_edit_team",
    },
  });
}

// ── Series cancel customer email ─────────────────────────────────────────

export async function sendSeriesCancelCustomerEmail(args: {
  shopId: string;
  seriesId: string;
  serviceName: string;
  remainingCancelled: number;
  reason: string | null;
  customerEmail: string | null;
  customerFirstName: string | null;
}) {
  if (!args.customerEmail) {
    return { skipped: true as const, reason: "missing_email" };
  }
  const shop = await getShopById(args.shopId);
  const subject = `Your recurring ${args.serviceName} has been cancelled`;
  const firstName = args.customerFirstName ?? "there";

  const textLines = [
    `Hi ${firstName},`,
    "",
    `We've cancelled your recurring ${args.serviceName} with ${shop.name}.`,
    args.remainingCancelled > 0
      ? `${args.remainingCancelled} upcoming visit${args.remainingCancelled === 1 ? " has" : "s have"} been removed from your schedule.`
      : `No future visits were on the schedule.`,
    args.reason ? `Reason: ${args.reason}` : null,
    "",
    "We're sorry to see this end. If you'd like to start a recurring booking again at any point - or book a one-off - just reply to this email or give us a call. We'd love to keep looking after your vehicle.",
    "",
    "Thanks,",
    shop.name,
  ].filter(Boolean) as string[];

  const htmlLines = [
    `Hi ${escapeHtml(firstName)},`,
    `We've cancelled your recurring ${escapeHtml(args.serviceName)} with ${escapeHtml(shop.name)}.`,
    args.remainingCancelled > 0
      ? `${args.remainingCancelled} upcoming visit${args.remainingCancelled === 1 ? " has" : "s have"} been removed from your schedule.`
      : `No future visits were on the schedule.`,
    args.reason ? `Reason: ${escapeHtml(args.reason)}` : null,
    "We're sorry to see this end. If you'd like to start a recurring booking again at any point - or book a one-off - just reply to this email or give us a call. We'd love to keep looking after your vehicle.",
    `Thanks,<br/>${escapeHtml(shop.name)}`,
  ].filter(Boolean) as string[];

  const htmlBody = buildHtml({
    shopName: shop.name,
    subject,
    accent: "#c0392b",
    lines: htmlLines,
    rawHtml: true,
  });

  const fromLine = getShopContacts(shop).from_line;
  try {
    const response = await sendViaGmailSmtp({
      From: fromLine,
      To: args.customerEmail,
      Subject: subject,
      TextBody: textLines.join("\n"),
      HtmlBody: htmlBody,
      Metadata: {
        series_id: args.seriesId,
        shop_id: args.shopId,
        template_key: "booking_series_cancel_customer",
      },
    });
    return { skipped: false as const, providerMessageId: response.MessageID };
  } catch (err) {
    console.error("Series cancel customer email failed", { seriesId: args.seriesId, err });
    throw err;
  }
}

// ── Series cancel team notification ──────────────────────────────────────

export async function sendSeriesCancelTeamNotification(args: {
  shopId: string;
  seriesId: string;
  serviceName: string;
  remainingCancelled: number;
  reason: string | null;
  customerName: string | null;
  customerEmail: string | null;
}) {
  const { team_email, from_line } = await getShopContactsById(args.shopId);
  const subject = `❌ Recurring series cancelled: ${args.customerName ?? "customer"} - ${args.serviceName}`;
  const crmUrl = `${CRM_BASE_URL}/series/${args.seriesId}`;

  const lines = [
    `${args.customerName ?? "A customer's"} recurring ${args.serviceName} has been cancelled by staff.`,
    `${args.remainingCancelled} future booking${args.remainingCancelled === 1 ? " was" : "s were"} removed from the calendar.`,
    `Pending reminders for those bookings have been cancelled.`,
    args.reason ? `Reason: ${args.reason}` : "(no reason given)",
    args.customerEmail ? `Customer email: ${args.customerEmail}` : null,
  ].filter(Boolean) as string[];

  const textBody = [...lines, "", `Open in CRM: ${crmUrl}`].join("\n");
  const htmlBody = buildHtml({
    shopName: "CRM",
    subject,
    accent: "#c0392b",
    lines,
    ctaUrl: crmUrl,
    ctaLabel: "Open series in CRM →",
  });

  await getPostmarkClient().sendEmail({
    From: from_line,
    To: team_email,
    Subject: subject,
    TextBody: textBody,
    HtmlBody: htmlBody,
    MessageStream: "booking-emails",
    TrackOpens: false,
    TrackLinks: "None" as never,
    Metadata: {
      shop_id: args.shopId,
      series_id: args.seriesId,
      template_key: "booking_series_cancel_team",
    },
  });
}

// ── Shared HTML shell ────────────────────────────────────────────────────

function buildHtml(args: {
  shopName: string;
  subject: string;
  accent: string;
  lines: string[];
  ctaUrl?: string;
  ctaLabel?: string;
  /** If true, treat `lines` as pre-escaped HTML fragments; otherwise escape. */
  rawHtml?: boolean;
}) {
  const escape = args.rawHtml ? (s: string) => s : escapeHtml;
  const ctaBlock = args.ctaUrl && args.ctaLabel
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0 4px;">
         <tr><td align="center">
           <a href="${escapeHtml(args.ctaUrl)}" style="display:inline-block;padding:13px 28px;background:${args.accent};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;">${escapeHtml(args.ctaLabel)}</a>
         </td></tr>
       </table>`
    : "";

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#E5E4E2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#E5E4E2;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;">
          <tr>
            <td style="background:#1a1713;padding:28px 32px;border-radius:16px 16px 0 0;">
              <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#c9c5c0;">${escapeHtml(args.shopName)}</p>
              <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.25;">${escapeHtml(args.subject)}</h1>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:24px 32px;border-left:1px solid #e8e0d6;border-right:1px solid #e8e0d6;">
              ${args.lines
                .map((line) =>
                  line.trim().length === 0
                    ? `<div style="height:8px;"></div>`
                    : `<p style="margin:0 0 10px;font-size:14px;line-height:1.55;color:#1a1713;">${escape(line)}</p>`
                )
                .join("\n")}
              ${ctaBlock}
            </td>
          </tr>
          <tr>
            <td style="background:#1a1713;padding:18px 32px;border-radius:0 0 16px 16px;">
              <p style="margin:0;font-size:12px;color:#7a6f68;">${escapeHtml(args.shopName)} CRM</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`.trim();
}
