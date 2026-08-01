/**
 * Customer-portal transactional emails: magic-link sign-in and
 * detail-due reminders. Sent via the shop Gmail SMTP identities.
 */

import { formatInTimeZone } from "date-fns-tz";

import { EMAIL_HEAD_HARDENING } from "@/lib/email/sharedEmailStyles";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { sendViaGmailSmtp } from "@/lib/email/smtpClient";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const CRM_BASE_URL = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";

// Portal emails come from the Wellington brand mailbox by default -
// the portal is brand-level (one account covers both shops).
const PORTAL_FROM = "Clean Car Collective <hello@cleancarcollective.co.nz>";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shell(title: string, inner: string): string {
  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    ${EMAIL_HEAD_HARDENING}
  </head>
  <body style="margin:0;padding:0;background-color:#E5E4E2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#E5E4E2;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;">
          <tr>
            <td bgcolor="#1a1713" style="background-color:#1a1713;border-radius:16px 16px 0 0;padding:28px 34px;">
              <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#c9c5c0;">Clean Car Collective</p>
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;line-height:1.15;">${escapeHtml(title)}</h1>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:32px 34px;border-left:1px solid #e8e0d6;border-right:1px solid #e8e0d6;">
              ${inner}
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
}

async function recordEmail(args: {
  shopId: string | null;
  contactId: string | null;
  subject: string;
  html: string;
  to: string;
  templateKey: string;
}) {
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from("email_messages")
    .insert({
      shop_id: args.shopId,
      contact_id: args.contactId,
      lead_id: null,
      booking_id: null,
      template_id: null,
      subject: args.subject,
      body_rendered: args.html,
      status: "queued",
    })
    .select("id")
    .single();
  return data?.id ?? null;
}

async function markEmail(id: string | null, status: "sent" | "failed", providerMessageId?: string) {
  if (!id) return;
  const supabase = getSupabaseAdminClient();
  await supabase
    .from("email_messages")
    .update({
      status,
      ...(status === "sent" ? { sent_at: new Date().toISOString(), provider_message_id: providerMessageId ?? null } : {}),
    })
    .eq("id", id);
}

/**
 * Send a portal email via Gmail SMTP, falling back to Postmark if SMTP
 * fails. Gmail's outbound relay occasionally throttles (a burst of sends
 * returns a transient error) — without a fallback that bubbled up as a 500
 * on request-code and blocked the "load my details" prefill. Mirrors the
 * belt+braces pattern in the booking-email senders.
 */
async function deliverPortalEmail(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
  metadata?: Record<string, string>;
}): Promise<{ providerMessageId: string }> {
  try {
    const res = await sendViaGmailSmtp({
      From: PORTAL_FROM,
      To: args.to,
      Subject: args.subject,
      TextBody: args.text,
      HtmlBody: args.html,
      Metadata: args.metadata,
    });
    return { providerMessageId: res.MessageID };
  } catch (smtpErr) {
    console.warn("Portal email via SMTP failed, trying Postmark fallback", { to: args.to, subject: args.subject, smtpErr });
    const pm = await getPostmarkClient().sendEmail({
      From: PORTAL_FROM,
      To: args.to,
      Subject: args.subject,
      TextBody: args.text,
      HtmlBody: args.html,
      MessageStream: "booking-emails",
      TrackOpens: false,
      TrackLinks: "None" as never,
      Metadata: args.metadata,
    });
    return { providerMessageId: pm.MessageID };
  }
}

// ── Magic link ─────────────────────────────────────────────────────────

export async function sendMagicLinkEmail(args: {
  email: string;
  token: string;
  shopId: string | null;
  contactId: string | null;
  firstName: string | null;
}) {
  const link = `${CRM_BASE_URL}/account/verify?token=${encodeURIComponent(args.token)}`;
  const subject = "Your sign-in link - Clean Car Collective";
  const greeting = args.firstName ? `Hi ${escapeHtml(args.firstName)},` : "Hi,";

  const html = shell("Sign in to your account", `
    <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#5c5148;">${greeting}<br/>
    Tap the button below to sign in to your Clean Car Collective account. The link works once and expires in 20 minutes.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:22px;">
      <tr><td align="center">
        <a href="${escapeHtml(link)}" style="display:inline-block;padding:15px 40px;background:#1a1713;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:12px;">Sign in</a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#9e9189;">Didn't request this? You can safely ignore this email - no one can access your account without this link.</p>
  `);

  const text = `${args.firstName ? `Hi ${args.firstName},` : "Hi,"}

Sign in to your Clean Car Collective account:
${link}

The link works once and expires in 20 minutes. Didn't request this? Ignore this email.`;

  const messageId = await recordEmail({
    shopId: args.shopId,
    contactId: args.contactId,
    subject,
    html,
    to: args.email,
    templateKey: "portal-magic-link",
  });

  try {
    const { providerMessageId } = await deliverPortalEmail({
      to: args.email,
      subject,
      text,
      html,
      metadata: { template_key: "portal-magic-link", email_message_id: messageId ?? "none" },
    });
    await markEmail(messageId, "sent", providerMessageId);
  } catch (err) {
    await markEmail(messageId, "failed");
    throw err;
  }
}

// ── Checkout code (6-digit OTP) ────────────────────────────────────────

export async function sendCheckoutCodeEmail(args: {
  email: string;
  code: string;
  shopId: string | null;
  contactId: string | null;
  firstName: string | null;
}) {
  const subject = `${args.code} is your Clean Car Collective code`;
  const greeting = args.firstName ? `Hi ${escapeHtml(args.firstName)},` : "Hi,";

  const html = shell("Your booking code", `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#5c5148;">${greeting}<br/>
    Enter this code on the booking page to load your saved details:</p>
    <p style="margin:0 0 18px;text-align:center;">
      <span style="display:inline-block;padding:14px 28px;background:#f7f3ee;border:1px solid #e8e0d6;border-radius:12px;font-size:32px;font-weight:800;letter-spacing:0.35em;color:#1a1713;">${escapeHtml(args.code)}</span>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#9e9189;">The code expires in 10 minutes and works once. Didn't request it? You can safely ignore this email.</p>
  `);

  const text = `${args.firstName ? `Hi ${args.firstName},` : "Hi,"}

Your Clean Car Collective booking code: ${args.code}

Enter it on the booking page to load your saved details. Expires in 10 minutes, works once. Didn't request it? Ignore this email.`;

  const messageId = await recordEmail({
    shopId: args.shopId,
    contactId: args.contactId,
    subject,
    html,
    to: args.email,
    templateKey: "portal-checkout-code",
  });

  try {
    const { providerMessageId } = await deliverPortalEmail({
      to: args.email,
      subject,
      text,
      html,
      metadata: { template_key: "portal-checkout-code", email_message_id: messageId ?? "none" },
    });
    await markEmail(messageId, "sent", providerMessageId);
  } catch (err) {
    await markEmail(messageId, "failed");
    throw err;
  }
}

// ── Detail-due reminder ────────────────────────────────────────────────

export async function sendDetailDueEmail(args: {
  email: string;
  firstName: string | null;
  shopId: string;
  shopSlug: string;
  contactId: string;
  vehicleLabel: string | null;
  serviceName: string | null;
  cadenceMonths: number;
  lastVisitAt: string | null;
  timezone: string;
  /** The reminder's due date - the email fires days earlier, opening a
   *  priority window before the customer's usual slot fills. */
  dueAt?: string | null;
}) {
  const bookingUrl =
    args.shopSlug === "christchurch"
      ? "https://cleancarcollective.co.nz/christchurch-make-a-booking"
      : "https://cleancarcollective.co.nz/make-a-booking";
  const accountUrl = `${CRM_BASE_URL}/account`;

  const vehicleBit = args.vehicleLabel ? ` for your ${escapeHtml(args.vehicleLabel)}` : "";
  const serviceBit = args.serviceName ? escapeHtml(args.serviceName) : "detail";
  const lastBit = args.lastVisitAt
    ? `It's been about ${args.cadenceMonths} month${args.cadenceMonths === 1 ? "" : "s"} since your last visit on ${formatInTimeZone(args.lastVisitAt, args.timezone, "d MMM")}.`
    : `Your ${args.cadenceMonths}-month reminder has come around.`;
  const dueBit = args.dueAt
    ? `Your slot comes due around <strong>${formatInTimeZone(args.dueAt, args.timezone, "EEEE d MMMM")}</strong> - you're hearing early so you get first pick of the calendar.`
    : `Spots book out 1-2 weeks ahead, so now's the perfect time to lock yours in.`;

  const subject = args.vehicleLabel
    ? `Priority booking open: your ${args.vehicleLabel}'s next detail`
    : "Priority booking open: your next detail";
  const greeting = args.firstName ? `Hi ${escapeHtml(args.firstName)},` : "Hi,";

  const html = shell("Your priority window is open", `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#5c5148;">${greeting}<br/>
    ${lastBit} ${dueBit}</p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#5c5148;">Book your next ${serviceBit}${vehicleBit} now and take whichever slot suits - before the week fills up.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:18px;">
      <tr><td align="center">
        <a href="${escapeHtml(bookingUrl)}" style="display:inline-block;padding:15px 40px;background:#1a1713;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:12px;">Book my slot</a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#9e9189;">Manage your reminders anytime in <a href="${escapeHtml(accountUrl)}" style="color:#5c5148;">your account</a>. Not ready yet? We'll leave it with you - this is your scheduled nudge, not a sales blast.</p>
  `);

  const text = `${args.firstName ? `Hi ${args.firstName},` : "Hi,"}

${args.lastVisitAt ? `It's been about ${args.cadenceMonths} months since your last visit.` : "Your detail reminder has come around."}${args.dueAt ? ` Your slot comes due around ${formatInTimeZone(args.dueAt, args.timezone, "EEEE d MMMM")} - you're hearing early so you get first pick of the calendar.` : ""} Book your next ${args.serviceName ?? "detail"}${args.vehicleLabel ? ` for your ${args.vehicleLabel}` : ""} now.

Book: ${bookingUrl}
Manage reminders: ${accountUrl}`;

  const messageId = await recordEmail({
    shopId: args.shopId,
    contactId: args.contactId,
    subject,
    html,
    to: args.email,
    templateKey: "portal-detail-due",
  });

  try {
    const { providerMessageId } = await deliverPortalEmail({
      to: args.email,
      subject,
      text,
      html,
      metadata: { template_key: "portal-detail-due", email_message_id: messageId ?? "none" },
    });
    await markEmail(messageId, "sent", providerMessageId);
  } catch (err) {
    await markEmail(messageId, "failed");
    throw err;
  }
}
