/**
 * Team notification emails for customer self-service actions (cancel /
 * reschedule) with a durable fallback.
 *
 * The original implementation lived inside the booking-action route as a
 * fire-and-forget Postmark call wrapped in try/catch — when the send threw
 * (suppressed recipient, stream issue, transient Postmark error) the error
 * was swallowed to console and staff never learned a booking was cancelled
 * (2026-07-14: two CHC ceramic-ad cancellations went unseen).
 *
 * Now: try the direct send for instant delivery; on ANY failure, enqueue a
 * `team_notification` row in scheduled_email_jobs so the process-scheduled
 * cron delivers it with retries + backoff, and the failure is visible in
 * the jobs table instead of vanishing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { getShopContacts } from "@/lib/email/shopContacts";

const CRM_BASE_URL = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";

export type TeamNotifyShop = { id: string; slug: string; name: string; timezone: string };

export type TeamNotifyArgs = {
  shop: TeamNotifyShop;
  bookingId: string;
  kind: "cancel" | "reschedule";
  subject: string;
  lines: string[];
};

export type TeamNotifyPayload = {
  kind: "cancel" | "reschedule";
  subject: string;
  lines: string[];
};

/** Direct Postmark send — throws on failure. */
export async function sendTeamNotificationNow(args: TeamNotifyArgs) {
  const { team_email, reply_email, from_line: from } = getShopContacts(args.shop);
  // Send to the group inbox AND the shop's watched customer inbox. On
  // Christchurch these differ (team_email=info@ group inbox vs reply_email=ben@
  // which staff actually monitor), so a self-service cancel/reschedule to info@
  // alone was going unseen. Dedupe in case they're the same (Wellington).
  const recipients = Array.from(new Set([team_email, reply_email].filter(Boolean))).join(", ");
  const crmUrl = `${CRM_BASE_URL}/bookings/${args.bookingId}`;
  const ctaLabel = args.kind === "cancel" ? "View cancelled booking in CRM →" : "Open booking & confirm new time →";

  // Plain text body - Postmark requires this even when HtmlBody is set,
  // and some inboxes still prefer the text version.
  const textBody = [...args.lines, "", `Open in CRM: ${crmUrl}`].join("\n");

  // HTML body - same lines as plain text plus a styled CTA button so staff
  // can jump straight to the booking. Layout mirrors the other internal
  // notification emails (daily-digest, approval-pending, etc.).
  const accent = args.kind === "cancel" ? "#c0392b" : "#1a4d2e";
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
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.2;">${escapeHtml(args.subject)}</h1>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:28px 32px;border-left:1px solid #e8e0d6;border-right:1px solid #e8e0d6;">
              ${args.lines
                .map((line) => line.trim().length === 0
                  ? `<div style="height:8px;"></div>`
                  : `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#1a1713;">${escapeHtml(line)}</p>`
                ).join("\n")}
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0 4px;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(crmUrl)}" style="display:inline-block;padding:13px 28px;background:${accent};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;">
                      ${escapeHtml(ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#1a1713;padding:18px 32px;border-radius:0 0 16px 16px;">
              <p style="margin:0;font-size:12px;color:#7a6f68;">${escapeHtml(args.shop.name)} CRM - sent automatically by the customer-action handler</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
  `.trim();

  const postmark = getPostmarkClient();
  await postmark.sendEmail({
    From: from,
    To: recipients,
    Subject: args.subject,
    TextBody: textBody,
    HtmlBody: htmlBody,
    MessageStream: "booking-emails",
    TrackOpens: false,
    TrackLinks: "None" as never,
    Metadata: {
      shop_id: args.shop.id,
      booking_id: args.bookingId,
      template_key: `booking_action_${args.kind}`,
    },
  });
}

/**
 * Enqueue a team_notification job for the process-scheduled cron. Used as
 * the fallback when the direct send fails — the cron retries with backoff
 * and failures land in scheduled_email_jobs.last_error where they're visible.
 */
export async function enqueueTeamNotification(
  supabase: SupabaseClient,
  args: { shopId: string; bookingId: string | null; payload: TeamNotifyPayload }
) {
  const { error } = await supabase.from("scheduled_email_jobs").insert({
    shop_id: args.shopId,
    lead_id: null,
    contact_id: null,
    booking_id: args.bookingId,
    job_type: "team_notification",
    template_key: "team_notification",
    scheduled_for: new Date().toISOString(),
    payload_json: args.payload,
    status: "pending",
  });
  if (error) {
    throw new Error(`Failed to enqueue team_notification: ${error.message}`);
  }
}

/**
 * Send a team notification with the direct path, falling back to the job
 * queue. Never throws — but unlike the old swallow-everything catch, a
 * total failure (send AND enqueue) is logged with both error messages.
 */
export async function notifyTeamReliable(supabase: SupabaseClient, args: TeamNotifyArgs) {
  try {
    await sendTeamNotificationNow(args);
  } catch (sendErr) {
    const sendMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
    console.error(`Team notification direct send failed (${args.kind}, booking ${args.bookingId}): ${sendMsg} — enqueueing fallback job`);
    try {
      await enqueueTeamNotification(supabase, {
        shopId: args.shop.id,
        bookingId: args.bookingId,
        payload: { kind: args.kind, subject: args.subject, lines: args.lines },
      });
    } catch (queueErr) {
      const queueMsg = queueErr instanceof Error ? queueErr.message : String(queueErr);
      console.error(`Team notification TOTAL failure (booking ${args.bookingId}): send="${sendMsg}" enqueue="${queueMsg}"`);
    }
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
