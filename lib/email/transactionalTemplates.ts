import type { BookingConfirmationEmailContext } from "@/lib/email/types";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function nl2br(value: string) {
  return escapeHtml(value).replaceAll("\n", "<br />");
}

function getEmailHeading(introLine: string): string {
  const lower = introLine.toLowerCase();
  if (lower.includes("confirmed")) return "Booking Confirmed";
  if (lower.includes("one week") || lower.includes("one-week")) return "Booking Reminder — 1 Week";
  if (lower.includes("one day") || lower.includes("one-day") || lower.includes("tomorrow")) return "Booking Reminder — Tomorrow";
  if (lower.includes("one hour") || lower.includes("one-hour")) return "Booking Reminder — 1 Hour";
  if (lower.includes("new booking")) return "New Booking";
  return "Booking Update";
}

export function renderTransactionalHtmlEmail(context: BookingConfirmationEmailContext) {
  const heading = getEmailHeading(context.intro_line);

  const infoRow = (label: string, value: string) => `
    <tr>
      <td style="padding: 13px 0; border-bottom: 1px solid #ede6dc;">
        <span style="display: block; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #9e9189; margin-bottom: 3px;">${escapeHtml(label)}</span>
        <span style="font-size: 15px; font-weight: 600; color: #1a1713;">${escapeHtml(value)}</span>
      </td>
    </tr>
  `;

  const mapButton = context.shop_map_link
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto 0 0;">
        <tr>
          <td style="border-radius: 10px; background: #1a1713;">
            <a href="${escapeHtml(context.shop_map_link)}"
               target="_blank"
               style="display: inline-block; padding: 12px 24px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; letter-spacing: 0.02em;">
              &#128205; View on Google Maps
            </a>
          </td>
        </tr>
      </table>
    `
    : "";

  const notesBlock = context.notes && context.notes !== "No additional notes."
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 28px; background: #f7f3ee; border-radius: 12px; border: 1px solid #e8e0d6;">
        <tr>
          <td style="padding: 18px 22px;">
            <p style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Notes</p>
            <p style="margin: 0; font-size: 14px; line-height: 1.65; color: #5c5148;">${nl2br(context.notes)}</p>
          </td>
        </tr>
      </table>
    `
    : "";

  const addOnsBlock = context.add_ons && context.add_ons !== "None"
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 28px; background: #f7f3ee; border-radius: 12px; border: 1px solid #e8e0d6;">
        <tr>
          <td style="padding: 18px 22px;">
            <p style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Add-ons</p>
            <p style="margin: 0; font-size: 14px; line-height: 1.65; color: #5c5148;">${escapeHtml(context.add_ons)}</p>
          </td>
        </tr>
      </table>
    `
    : "";

  const updateSummaryBlock = context.update_summary
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 28px; background: #f7f3ee; border-radius: 12px; border: 1px solid #e8e0d6;">
        <tr>
          <td style="padding: 18px 22px;">
            <p style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Updated details</p>
            <p style="margin: 0; font-size: 14px; line-height: 1.65; color: #5c5148;">${nl2br(context.update_summary)}</p>
          </td>
        </tr>
      </table>
    `
    : "";

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <title>${escapeHtml(heading)}</title>
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
                <h1 style="margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; line-height: 1.15;">${escapeHtml(heading)}</h1>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="background: #ffffff; padding: 36px 36px 32px; border-left: 1px solid #e8e0d6; border-right: 1px solid #e8e0d6;">

                <p style="margin: 0 0 6px; font-size: 17px; font-weight: 600; color: #1a1713;">Hi ${escapeHtml(context.first_name)},</p>
                <p style="margin: 0 0 28px; font-size: 15px; line-height: 1.65; color: #5c5148;">${escapeHtml(context.intro_line)}</p>

                <!-- Time -->
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 16px; background: #f7f3ee; border-radius: 12px; border: 1px solid #e8e0d6;">
                  <tr>
                    <td style="padding: 20px 22px;">
                      <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Time</p>
                      <p style="margin: 0; font-size: 20px; font-weight: 700; color: #1a1713; line-height: 1.2;">${escapeHtml(context.scheduled_date)}</p>
                      <p style="margin: 4px 0 0; font-size: 16px; font-weight: 500; color: #5c5148;">${escapeHtml(context.scheduled_time)}</p>
                    </td>
                  </tr>
                </table>

                <!-- Address -->
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; background: #f7f3ee; border-radius: 12px; border: 1px solid #e8e0d6;">
                  <tr>
                    <td style="padding: 20px 22px;">
                      <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Address</p>
                      <p style="margin: 0; font-size: 15px; font-weight: 600; color: #1a1713; line-height: 1.5;">${escapeHtml(context.shop_address)}</p>
                    </td>
                  </tr>
                </table>

                <!-- Description -->
                <p style="margin: 0 0 0; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Description</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-top: 1px solid #ede6dc;">
                  ${infoRow("Service", context.service_name)}
                  ${context.add_ons && context.add_ons !== "None" ? infoRow("Add-ons", context.add_ons) : ""}
                  ${infoRow("Vehicle", context.vehicle_label)}
                  ${infoRow("Location type", context.location_type)}
                  ${context.price_estimate ? infoRow("Estimated price", context.price_estimate + " +GST") : ""}
                </table>

                ${context.customer_name || context.customer_email || context.customer_phone ? `
                <!-- Customer details (team emails only) -->
                <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Customer</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-top: 1px solid #ede6dc;">
                  ${context.customer_name ? infoRow("Name", context.customer_name) : ""}
                  ${context.customer_email ? infoRow("Email", context.customer_email) : ""}
                  ${context.customer_phone ? infoRow("Phone", context.customer_phone) : ""}
                </table>
                ` : ""}

                ${updateSummaryBlock}
                ${addOnsBlock}
                ${notesBlock}

                <!-- Contact -->
                <p style="margin: 0 0 4px; font-size: 15px; line-height: 1.6; color: #5c5148;">Please reach out if you need to make any changes.</p>
                <p style="margin: 0 0 28px; font-size: 15px; color: #5c5148;">
                  <a href="mailto:${escapeHtml(context.shop_email)}" style="color: #1a1713; font-weight: 600; text-decoration: none;">${escapeHtml(context.shop_email)}</a>
                  &nbsp;&middot;&nbsp;
                  <a href="tel:${escapeHtml(context.shop_phone.replaceAll(" ", ""))}" style="color: #1a1713; font-weight: 600; text-decoration: none;">${escapeHtml(context.shop_phone)}</a>
                </p>

                ${mapButton}

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background: #1a1713; border-radius: 0 0 16px 16px; padding: 22px 36px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td>
                      <p style="margin: 0 0 2px; font-size: 13px; font-weight: 600; color: #ffffff;">Clean Car Collective</p>
                      <p style="margin: 0; font-size: 12px; color: #7a6f68;">${escapeHtml(context.shop_address)}</p>
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
