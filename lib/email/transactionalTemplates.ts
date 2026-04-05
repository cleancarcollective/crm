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

export function renderTransactionalHtmlEmail(context: BookingConfirmationEmailContext) {
  const rows = [
    ["Service", context.service_name],
    ["Date", context.scheduled_date],
    ["Time", context.scheduled_time],
    ["Vehicle", context.vehicle_label],
    ["Location", context.location_type],
    ["Estimated price", context.price_estimate]
  ];

  const tableRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding: 12px 0; color: #70685f; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid #e5ddd2;">${escapeHtml(label)}</td>
          <td style="padding: 12px 0; color: #121212; font-size: 15px; font-weight: 600; text-align: right; border-bottom: 1px solid #e5ddd2;">${escapeHtml(value)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <!doctype html>
    <html lang="en">
      <body style="margin: 0; padding: 0; background: #efe9e1; font-family: Avenir Next, Helvetica Neue, Arial, sans-serif; color: #121212;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background: #efe9e1; padding: 28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 640px; background: #ffffff; border-radius: 24px; overflow: hidden; border: 1px solid #ddd5ca;">
                <tr>
                  <td style="padding: 26px 30px; background: linear-gradient(180deg, #1f1f1f, #0f0f0f); color: #ffffff;">
                    <div style="font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #cbc1b6; margin-bottom: 10px;">Clean Car Collective</div>
                    <div style="font-size: 30px; font-weight: 700; line-height: 1.05;">Booking Update</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 30px;">
                    <p style="margin: 0 0 12px; font-size: 16px; line-height: 1.6;">Hi ${escapeHtml(context.first_name)},</p>
                    <p style="margin: 0 0 18px; font-size: 16px; line-height: 1.6; color: #3b352f;">${escapeHtml(context.intro_line)}</p>

                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 18px;">
                      ${tableRows}
                    </table>

                    <div style="background: #f7f2eb; border: 1px solid #e5ddd2; border-radius: 18px; padding: 18px 20px; margin-bottom: 18px;">
                      <div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #70685f; margin-bottom: 8px;">Notes</div>
                      <div style="font-size: 15px; line-height: 1.6; color: #1d1b19;">${nl2br(context.notes)}</div>
                    </div>

                    <p style="margin: 0 0 10px; font-size: 15px; line-height: 1.6; color: #3b352f;">${escapeHtml(context.action_line)}</p>
                    <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #3b352f;">${escapeHtml(context.shop_name)}</p>
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
