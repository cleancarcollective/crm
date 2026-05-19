/**
 * Recurring-series notification emails.
 *
 * Industry standard: ONE confirmation email at signup that lays out the
 * whole schedule + cadence, then per-occurrence reminders fire as normal
 * (these are already wired by createReminderJobsForBooking).
 *
 * Two functions here:
 *   - sendSeriesConfirmationEmail → customer, via Gmail SMTP (Primary tab)
 *   - sendSeriesTeamNotification → team inbox, via Postmark (event tracking)
 *
 * No template_id is used — this is a one-off inline-HTML email like the
 * cancel/reschedule notifications. Adding it to email_templates would
 * require a migration + per-shop seed; not worth it for a v1 message
 * that's unlikely to change copy often.
 */

import { formatInTimeZone } from "date-fns-tz";

import { formatCurrency } from "@/lib/dashboard/format";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { getShopContacts } from "@/lib/email/shopContacts";
import { sendViaGmailSmtp } from "@/lib/email/smtpClient";
import type { ShopRecord } from "@/lib/dashboard/types";

const CRM_BASE_URL = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";

type Args = {
  shop: ShopRecord;
  seriesId: string;
  contact: {
    firstName: string | null;
    fullName: string | null;
    email: string | null;
  };
  serviceName: string;
  priceEstimate: number | null;
  cadenceLabel: string;            // e.g. "Fortnightly on Tuesdays at 9:00 AM"
  occurrenceDatesIso: string[];    // chronological ISO timestamps
  bookingsCount: number;           // total occurrences generated up front
  endLabel: string;                // e.g. "runs until cancelled" / "12 occurrences" / "until 4 Dec 2026"
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatOccurrenceList(occurrenceDatesIso: string[], tz: string, maxToShow = 8) {
  const visible = occurrenceDatesIso.slice(0, maxToShow);
  const more = occurrenceDatesIso.length - visible.length;
  const items = visible.map((iso) => formatInTimeZone(iso, tz, "EEE d MMM yyyy 'at' h:mm a"));
  if (more > 0) {
    items.push(`+ ${more} more date${more === 1 ? "" : "s"}`);
  }
  return items;
}

export async function sendSeriesConfirmationEmail(args: Args) {
  if (!args.contact.email) {
    console.info("Series confirmation skipped: contact has no email", { seriesId: args.seriesId });
    return { skipped: true as const, reason: "missing_email" };
  }
  if (args.occurrenceDatesIso.length === 0) {
    console.info("Series confirmation skipped: no occurrences", { seriesId: args.seriesId });
    return { skipped: true as const, reason: "no_occurrences" };
  }

  const firstName = args.contact.firstName ?? "there";
  const firstDateLabel = formatInTimeZone(args.occurrenceDatesIso[0], args.shop.timezone, "EEEE d MMMM yyyy");
  const firstTimeLabel = formatInTimeZone(args.occurrenceDatesIso[0], args.shop.timezone, "h:mm a");
  const dates = formatOccurrenceList(args.occurrenceDatesIso, args.shop.timezone);
  const priceLine = args.priceEstimate != null ? `${formatCurrency(args.priceEstimate)} per visit` : null;
  const subject = `Your recurring ${args.serviceName} is booked — starting ${firstDateLabel}`;

  const textBody = [
    `Hi ${firstName},`,
    ``,
    `You're all set! Your recurring ${args.serviceName} with ${args.shop.name} is confirmed.`,
    ``,
    `Schedule: ${args.cadenceLabel}`,
    `First visit: ${firstDateLabel} at ${firstTimeLabel}`,
    priceLine ? `Price: ${priceLine}` : null,
    `Series: ${args.endLabel}`,
    ``,
    `Upcoming dates:`,
    ...dates.map((d) => `  • ${d}`),
    ``,
    `We'll send you a reminder a few days before each visit, and again the day before.`,
    ``,
    `Need to cancel or reschedule a single visit, or end the recurring booking entirely? Just reply to this email or call us — we'll sort it.`,
    ``,
    `Thanks,`,
    `${args.shop.name}`,
  ]
    .filter(Boolean)
    .join("\n");

  const accent = "#1a4d2e";
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
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.25;">Your recurring ${escapeHtml(args.serviceName)} is booked</h1>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:28px 32px;border-left:1px solid #e8e0d6;border-right:1px solid #e8e0d6;">
              <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#1a1713;">Hi ${escapeHtml(firstName)},</p>
              <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#1a1713;">You're all set. Your recurring ${escapeHtml(args.serviceName)} with ${escapeHtml(args.shop.name)} is confirmed.</p>

              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e8e0d6;border-radius:10px;margin:0 0 18px;">
                <tr><td style="padding:14px 16px;border-bottom:1px solid #e8e0d6;font-size:13px;color:#7a6f68;">Schedule</td><td style="padding:14px 16px;border-bottom:1px solid #e8e0d6;font-size:14px;color:#1a1713;font-weight:600;">${escapeHtml(args.cadenceLabel)}</td></tr>
                <tr><td style="padding:14px 16px;border-bottom:1px solid #e8e0d6;font-size:13px;color:#7a6f68;">First visit</td><td style="padding:14px 16px;border-bottom:1px solid #e8e0d6;font-size:14px;color:#1a1713;font-weight:600;">${escapeHtml(firstDateLabel)} at ${escapeHtml(firstTimeLabel)}</td></tr>
                ${priceLine ? `<tr><td style="padding:14px 16px;border-bottom:1px solid #e8e0d6;font-size:13px;color:#7a6f68;">Price</td><td style="padding:14px 16px;border-bottom:1px solid #e8e0d6;font-size:14px;color:#1a1713;font-weight:600;">${escapeHtml(priceLine)}</td></tr>` : ""}
                <tr><td style="padding:14px 16px;font-size:13px;color:#7a6f68;">Series</td><td style="padding:14px 16px;font-size:14px;color:#1a1713;font-weight:600;">${escapeHtml(args.endLabel)}</td></tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#7a6f68;font-weight:600;">Upcoming dates</p>
              <ul style="margin:0 0 18px;padding-left:18px;font-size:14px;line-height:1.7;color:#1a1713;">
                ${dates.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}
              </ul>

              <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#1a1713;">We'll send you a reminder a few days before each visit, and again the day before.</p>
              <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#1a1713;">Need to cancel or reschedule a single visit, or end the recurring booking entirely? Just reply to this email or call us — we'll sort it.</p>
              <p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:#1a1713;">Thanks,<br/>${escapeHtml(args.shop.name)}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#1a1713;padding:18px 32px;border-radius:0 0 16px 16px;">
              <p style="margin:0;font-size:12px;color:#7a6f68;">${escapeHtml(args.shop.name)} · ${escapeHtml(getShopContacts(args.shop).reply_email)}</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
  `.trim();

  const fromLine = getShopContacts(args.shop).from_line;
  try {
    const response = await sendViaGmailSmtp({
      From: fromLine,
      To: args.contact.email,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
      Metadata: {
        series_id: args.seriesId,
        shop_id: args.shop.id,
        template_key: "booking_series_confirmation",
      },
    });
    // Tiny diagnostic so the SMTP id is searchable later if needed.
    console.info("Series confirmation email sent", { seriesId: args.seriesId, providerMessageId: response.MessageID });
    return { skipped: false as const, providerMessageId: response.MessageID };
  } catch (err) {
    console.error("Series confirmation email failed", { seriesId: args.seriesId, err });
    throw err;
  } finally {
    void accent; // silence unused — kept for future style tweaks
  }
}

export async function sendSeriesTeamNotification(args: Args) {
  const { team_email, from_line } = getShopContacts(args.shop);
  const firstDateLabel = formatInTimeZone(args.occurrenceDatesIso[0], args.shop.timezone, "EEE d MMM yyyy 'at' h:mm a");
  const subject = `🔁 New recurring booking: ${args.contact.fullName ?? args.contact.firstName ?? "Customer"}`;
  const seriesCrmUrl = `${CRM_BASE_URL}/series/${args.seriesId}`;

  const lines = [
    `${args.contact.fullName ?? args.contact.firstName ?? "A customer"} signed up for a recurring ${args.serviceName}.`,
    `Schedule: ${args.cadenceLabel}`,
    `First visit: ${firstDateLabel}`,
    `Series: ${args.endLabel}`,
    `Generated ${args.bookingsCount} occurrence${args.bookingsCount === 1 ? "" : "s"} up to 12 months ahead.`,
    args.contact.email ? `Customer email: ${args.contact.email}` : null,
    ``,
    `The customer has received their series confirmation email with the full schedule.`,
  ].filter(Boolean) as string[];

  const textBody = [...lines, "", `Open in CRM: ${seriesCrmUrl}`].join("\n");

  const accent = "#1a4d2e";
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
              <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.25;">${escapeHtml(subject)}</h1>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:24px 32px;border-left:1px solid #e8e0d6;border-right:1px solid #e8e0d6;">
              ${lines
                .map((line) =>
                  line.trim().length === 0
                    ? `<div style="height:8px;"></div>`
                    : `<p style="margin:0 0 10px;font-size:14px;line-height:1.55;color:#1a1713;">${escapeHtml(line)}</p>`
                )
                .join("\n")}
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0 4px;">
                <tr><td align="center">
                  <a href="${escapeHtml(seriesCrmUrl)}" style="display:inline-block;padding:13px 28px;background:${accent};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;">Open series in CRM →</a>
                </td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#1a1713;padding:18px 32px;border-radius:0 0 16px 16px;">
              <p style="margin:0;font-size:12px;color:#7a6f68;">${escapeHtml(args.shop.name)} CRM — recurring booking created</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
  `.trim();

  try {
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
        shop_id: args.shop.id,
        series_id: args.seriesId,
        template_key: "booking_series_team_notification",
      },
    });
  } catch (err) {
    console.error("Series team notification failed", { seriesId: args.seriesId, err });
    // Non-fatal — customer-facing email is what matters; team can find the
    // series in the CRM either way.
  }
}

/**
 * Build a human-readable cadence label from the recurrence rule fields.
 * E.g. "Weekly on Tuesdays at 9:00 AM", "Fortnightly on Tuesdays at 9:00 AM",
 *      "Every 3 weeks on Tuesdays at 9:00 AM",
 *      "Monthly on the 2nd Tuesday at 9:00 AM",
 *      "Every 14 days at 9:00 AM".
 */
export function buildCadenceLabel(opts: {
  frequency: "days" | "weeks" | "months_nth_weekday";
  intervalCount: number;
  firstOccurrenceIso: string;
  timezone: string;
  nthWeekOfMonth?: number | null;
}): string {
  const timeOfDay = formatInTimeZone(opts.firstOccurrenceIso, opts.timezone, "h:mm a");
  const weekday = formatInTimeZone(opts.firstOccurrenceIso, opts.timezone, "EEEE");

  if (opts.frequency === "days") {
    if (opts.intervalCount === 1) return `Every day at ${timeOfDay}`;
    if (opts.intervalCount === 7) return `Weekly on ${weekday}s at ${timeOfDay}`;
    if (opts.intervalCount === 14) return `Fortnightly on ${weekday}s at ${timeOfDay}`;
    return `Every ${opts.intervalCount} days at ${timeOfDay}`;
  }

  if (opts.frequency === "weeks") {
    if (opts.intervalCount === 1) return `Weekly on ${weekday}s at ${timeOfDay}`;
    if (opts.intervalCount === 2) return `Fortnightly on ${weekday}s at ${timeOfDay}`;
    return `Every ${opts.intervalCount} weeks on ${weekday}s at ${timeOfDay}`;
  }

  // months_nth_weekday
  const nth = opts.nthWeekOfMonth;
  const nthLabel =
    nth === -1
      ? `last ${weekday}`
      : nth === 1
        ? `1st ${weekday}`
        : nth === 2
          ? `2nd ${weekday}`
          : nth === 3
            ? `3rd ${weekday}`
            : `${nth}th ${weekday}`;
  const monthInterval = opts.intervalCount === 1 ? "month" : `${opts.intervalCount} months`;
  return `Every ${monthInterval} on the ${nthLabel} at ${timeOfDay}`;
}

/**
 * Build a human-readable end-condition label.
 *   never → "Runs until cancelled"
 *   after_n → "12 occurrences total"
 *   on_date → "Until 4 Dec 2026"
 */
export function buildEndLabel(opts: {
  endType: "never" | "after_n" | "on_date";
  endAfterN?: number | null;
  endOnDate?: string | null;
  timezone: string;
}): string {
  if (opts.endType === "after_n") {
    const n = opts.endAfterN ?? 0;
    return `${n} occurrence${n === 1 ? "" : "s"} total`;
  }
  if (opts.endType === "on_date" && opts.endOnDate) {
    return `Until ${formatInTimeZone(opts.endOnDate, opts.timezone, "d MMM yyyy")}`;
  }
  return "Runs until cancelled";
}
