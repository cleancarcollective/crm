import { EMAIL_HEAD_HARDENING } from "@/lib/email/sharedEmailStyles";
import type { BookingConfirmationEmailContext } from "@/lib/email/types";

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

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
  if (lower.includes("one week") || lower.includes("one-week")) return "Booking Reminder - 1 Week";
  if (lower.includes("one day") || lower.includes("one-day") || lower.includes("tomorrow")) return "Booking Reminder - Tomorrow";
  if (lower.includes("one hour") || lower.includes("one-hour")) return "Booking Reminder - 1 Hour";
  if (lower.includes("new booking")) return "New Booking";
  return "Booking Update";
}

/**
 * Christchurch-specific entrance notice for the 1-hour reminder.
 *
 * Customers occasionally try to enter from Southwark Street and can't find
 * the shop, since our entrance is on Allen Street (south side of the block).
 * For the 1-hour reminder only - they're already on their way at this point,
 * so the note is most useful right before arrival.
 *
 * Wellington and other shops are unaffected because the trigger checks the
 * shop_address contains "Southwark" (Christchurch's address).
 *
 * The map image is hosted statically at /images/... - see public/images/
 * folder. If the image fails to load, the prose still conveys the message.
 */
const ENTRANCE_MAP_URL = "https://crm.cleancarcollective.co.nz/images/booking-reminder-allen-entrance-map.png";

function entranceNoticeBlock(
  context: BookingConfirmationEmailContext,
  heading: string
): string {
  // Only show on the 1-hour reminder (heading set by getEmailHeading)
  if (heading !== "Booking Reminder - 1 Hour") return "";
  // Only show for Christchurch (Southwark Street workshop)
  if (!context.shop_address.includes("Southwark")) return "";
  // Skip for mobile bookings (we come to them, no entrance to find)
  if (context.shop_address.toLowerCase().includes("mobile")) return "";

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="margin: 0 0 24px; background: #fff8e6; border: 1px solid #f5d87a; border-radius: 12px;">
      <tr>
        <td style="padding: 18px 22px;">
          <p style="margin: 0 0 8px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #a37400;">
            Important - entrance
          </p>
          <p style="margin: 0 0 14px; font-size: 15px; font-weight: 600; line-height: 1.5; color: #1a1713;">
            Please enter from <span style="text-decoration: underline;">Allen Street</span>, not Southwark Street.
          </p>
          <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.55; color: #5c5148;">
            Our workshop entrance is at the rear of the building, accessible from Allen St (south side of the block). Look for our Clean Car Collective signage.
          </p>
          <a href="${context.shop_map_link ? escapeHtml(context.shop_map_link) : "https://maps.app.goo.gl/jAb6JhCgXV8Nafc49"}"
             target="_blank"
             style="display: block; text-decoration: none;">
            <img src="${ENTRANCE_MAP_URL}"
                 alt="Map showing Clean Car Collective entrance from Allen Street"
                 width="600"
                 style="display: block; width: 100%; max-width: 540px; height: auto; border-radius: 10px; border: 1px solid #e8e0d6;" />
          </a>
        </td>
      </tr>
    </table>
  `;
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

  // Notes-as-paragraph row (used inside the Description table, not as a
  // standalone highlighted block - that was creating duplicate info).
  const hasMeaningfulNotes =
    context.notes &&
    context.notes !== "No additional notes." &&
    context.notes !== "No notes" &&
    context.notes.trim().length > 0;

  const notesRow = hasMeaningfulNotes
    ? `
      <tr>
        <td style="padding: 13px 0; border-bottom: 1px solid #ede6dc;">
          <span style="display: block; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #9e9189; margin-bottom: 3px;">Customer Notes</span>
          <span style="display: block; font-size: 15px; line-height: 1.55; color: #1a1713;">${nl2br(context.notes!)}</span>
        </td>
      </tr>
    `
    : "";

  // Standalone promo / discount-code callout. Yellow accent so the customer
  // can't miss the value (and it's visually distinct from their own notes).
  const promoBlock = context.promo_note
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; background: #fff8e6; border-radius: 12px; border-left: 3px solid #f4b942;">
        <tr>
          <td style="padding: 16px 22px;">
            <p style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #8a5a00;">🎁 Promo applied</p>
            <p style="margin: 0; font-size: 14px; line-height: 1.55; color: #1a1713;">${nl2br(context.promo_note)}</p>
          </td>
        </tr>
      </table>
    `
    : "";

  // Team-only "Open in CRM" CTA. Only emitted when crm_booking_url is set
  // (which sendBookingEmail does only for team-facing templates).
  const crmButton = context.crm_booking_url
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 12px 0 24px;">
        <tr>
          <td align="center">
            <a href="${escapeHtml(context.crm_booking_url)}" style="display: inline-block; padding: 12px 24px; background: #1a1713; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 10px;">
              Open in CRM →
            </a>
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
    ${EMAIL_HEAD_HARDENING}
  </head>
  <body style="margin: 0; padding: 0; background-color: #E5E4E2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #E5E4E2; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="email-card" style="max-width: 600px;">

            <!-- Header - solid bgcolor + class hooks for dark-mode hardening -->
            <tr>
              <td bgcolor="#1a1713" class="email-header email-pad-x" style="background-color: #1a1713; background-image: linear-gradient(160deg, #1a1713 0%, #0d0c0b 100%); border-radius: 16px 16px 0 0; padding: 32px 36px;">
                <p class="email-header-eyebrow" style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #c9c5c0;">Clean Car Collective</p>
                <h1 class="email-header-title" style="margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; line-height: 1.15;">${escapeHtml(heading)}</h1>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td class="email-pad-x" style="background: #ffffff; padding: 36px 36px 32px; border-left: 1px solid #e8e0d6; border-right: 1px solid #e8e0d6;">

                <p style="margin: 0 0 6px; font-size: 17px; font-weight: 600; color: #1a1713;">Hi ${escapeHtml(capitalise(context.first_name))},</p>
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

                <!-- Description - single source of truth, only fields that apply -->
                <p style="margin: 0 0 0; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Description</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-top: 1px solid #ede6dc;">
                  ${context.service_name ? infoRow("Service", context.service_name) : ""}
                  ${context.add_ons && context.add_ons !== "None" ? infoRow("Add-ons", context.add_ons) : ""}
                  ${context.vehicle_label && context.vehicle_label !== "Vehicle to be confirmed" ? infoRow("Vehicle", context.vehicle_label) : ""}
                  ${context.location_type && context.location_type !== "To be confirmed" ? infoRow("Location", context.location_type) : ""}
                  ${context.price_estimate ? infoRow("Estimated price", context.price_estimate) : ""}
                  ${notesRow}
                </table>

                ${context.customer_name || context.customer_email || context.customer_phone ? `
                <!-- Customer details (team emails only) -->
                <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Customer</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-top: 1px solid #ede6dc;">
                  ${context.customer_name ? infoRow("Name", context.customer_name) : ""}
                  ${context.customer_email ? infoRow("Email", context.customer_email) : ""}
                  ${context.customer_phone ? infoRow("Phone", context.customer_phone) : ""}
                  ${context.booking_source ? infoRow("Booking source", context.booking_source) : ""}
                </table>
                ` : ""}

                ${promoBlock}
                ${crmButton}
                ${updateSummaryBlock}
                ${entranceNoticeBlock(context, heading)}

                ${context.manage_booking_url ? `
                <!-- Self-service: reschedule / cancel -->
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0 12px;">
                  <tr>
                    <td align="center">
                      <a href="${escapeHtml(context.manage_booking_url)}" style="display: inline-block; padding: 12px 24px; background: #ffffff; border: 1.5px solid #1a1713; color: #1a1713; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 10px;">
                        Reschedule or cancel →
                      </a>
                      <p style="margin: 10px 0 0; font-size: 12px; color: #9e9189;">
                        Or manage all your bookings, vehicles &amp; reminders in
                        <a href="https://crm.cleancarcollective.co.nz/account" style="color: #5c5148;">your account</a> - no password needed.
                      </p>
                    </td>
                  </tr>
                </table>
                ` : ""}

                <!-- Contact -->
                <p style="margin: 0 0 4px; font-size: 15px; line-height: 1.6; color: #5c5148;">Or just reach out directly if you need anything.</p>
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
              <td bgcolor="#1a1713" class="email-footer email-pad-x" style="background-color: #1a1713; border-radius: 0 0 16px 16px; padding: 22px 36px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td>
                      <p class="email-footer-title" style="margin: 0 0 2px; font-size: 13px; font-weight: 600; color: #ffffff;">Clean Car Collective</p>
                      <p class="email-footer-sub" style="margin: 0; font-size: 12px; color: #7a6f68;">${escapeHtml(context.shop_address)}</p>
                    </td>
                    <td align="right" style="vertical-align: middle;">
                      <a class="email-footer-sub" href="${escapeHtml(context.shop_website)}" style="font-size: 12px; color: #7a6f68; text-decoration: none;">${escapeHtml(context.shop_website.replace("https://", ""))}</a>
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
