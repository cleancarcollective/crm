/**
 * Daily team email listing TODAY'S leads still waiting for staff approval
 * (the auto-respond couldn't auto-send a quote so it parked them in
 * `needs_approval`). Skips backlog from previous days - only fires on the
 * day the lead came in, so old data doesn't drown out the signal.
 *
 * Sends nothing if there are zero pending leads from today (no spam).
 *
 * Cron: 11am NZ daily - gives staff a couple of hours after morning
 * leads come in to clear them on their own first.
 */

import { formatInTimeZone } from "date-fns-tz";

import type { ShopRecord } from "@/lib/dashboard/types";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { EMAIL_HEAD_HARDENING } from "@/lib/email/sharedEmailStyles";
import { getShopContacts } from "@/lib/email/shopContacts";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type PendingLead = {
  id: string;
  created_at: string;
  service_requested: string | null;
  contact_id: string | null;
  contact: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null;
};

/**
 * Today's window in shop tz, returned as ISO strings with the shop's UTC
 * offset baked in so Postgres compares correctly.
 */
function getTodayWindow(now: Date, tz: string) {
  const todayDate = formatInTimeZone(now, tz, "yyyy-MM-dd");
  const offset = formatInTimeZone(now, tz, "XXX");
  return {
    startIso: `${todayDate}T00:00:00${offset}`,
    endIso: `${todayDate}T23:59:59${offset}`,
    label: formatInTimeZone(now, tz, "EEEE d MMM"),
  };
}

async function gatherPending(shop: ShopRecord) {
  const supabase = getSupabaseAdminClient();
  const now = new Date();
  const { startIso, endIso, label } = getTodayWindow(now, shop.timezone);

  const { data, error } = await supabase
    .from("leads")
    .select(`
      id, created_at, service_requested, contact_id,
      contact:contacts(first_name, last_name, email, phone)
    `)
    .eq("shop_id", shop.id)
    .eq("status", "needs_approval")
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return { pending: (data ?? []) as unknown as PendingLead[], todayLabel: label };
}

function renderRow(lead: PendingLead, tz: string) {
  const c = lead.contact ?? { first_name: null, last_name: null, email: null, phone: null };
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "-";
  const time = formatInTimeZone(lead.created_at, tz, "h:mma").toLowerCase();
  return `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #ede6dc; vertical-align: top;">
        <p style="margin: 0 0 2px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #9e9189;">${escapeHtml(time)}</p>
        <p style="margin: 0 0 4px; font-size: 15px; font-weight: 600; color: #1a1713;">${escapeHtml(name)}</p>
        <p style="margin: 0; font-size: 13px; color: #5c5148;">${escapeHtml(c.email ?? "-")}${c.phone ? ` · ${escapeHtml(c.phone)}` : ""}</p>
        ${lead.service_requested ? `<p style="margin: 4px 0 0; font-size: 13px; color: #5c5148;">${escapeHtml(lead.service_requested)}</p>` : ""}
      </td>
    </tr>
  `;
}

function renderHtml(shop: ShopRecord, pending: PendingLead[], todayLabel: string) {
  const rows = pending.map((p) => renderRow(p, shop.timezone)).join("");

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Approvals waiting</title>
    ${EMAIL_HEAD_HARDENING}
  </head>
  <body style="margin: 0; padding: 0; background-color: #E5E4E2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #E5E4E2; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="email-card" style="max-width: 600px;">

            <tr>
              <td bgcolor="#1a1713" class="email-header email-pad-x" style="background-color: #1a1713; background-image: linear-gradient(160deg, #1a1713 0%, #0d0c0b 100%); border-radius: 16px 16px 0 0; padding: 32px 36px;">
                <p class="email-header-eyebrow" style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #c9c5c0;">${escapeHtml(shop.name)}</p>
                <h1 class="email-header-title" style="margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; line-height: 1.15;">${pending.length} ${pending.length === 1 ? "lead is" : "leads are"} waiting on a quote</h1>
                <p style="margin: 8px 0 0; font-size: 13px; color: #9e9189;">From today - ${escapeHtml(todayLabel)}</p>
              </td>
            </tr>

            <tr>
              <td class="email-pad-x" style="background: #ffffff; padding: 28px 36px 28px; border-left: 1px solid #e8e0d6; border-right: 1px solid #e8e0d6;">
                <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #5c5148;">
                  These leads came in today and the auto-respond wasn't confident enough to send a quote. Review and approve or send manually.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top: 1px solid #ede6dc;">
                  ${rows}
                </table>

                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0 0;">
                  <tr>
                    <td align="center">
                      <a href="https://crm.cleancarcollective.co.nz/leads" style="display: inline-block; padding: 12px 28px; background: #1a1713; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 10px;">
                        Review in CRM →
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td bgcolor="#1a1713" class="email-footer email-pad-x" style="background-color: #1a1713; border-radius: 0 0 16px 16px; padding: 22px 36px;">
                <p class="email-footer-title" style="margin: 0 0 2px; font-size: 13px; font-weight: 600; color: #ffffff;">Clean Car Collective CRM</p>
                <p class="email-footer-sub" style="margin: 0; font-size: 12px; color: #7a6f68;">${escapeHtml(shop.name)} - sent only on days where leads are pending approval</p>
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

function renderText(shop: ShopRecord, pending: PendingLead[], todayLabel: string) {
  const lines = [
    `${shop.name} - ${pending.length} ${pending.length === 1 ? "lead" : "leads"} waiting on a quote (${todayLabel})`,
    ``,
  ];
  for (const lead of pending) {
    const c = lead.contact ?? { first_name: null, last_name: null, email: null, phone: null };
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "-";
    const time = formatInTimeZone(lead.created_at, shop.timezone, "h:mma").toLowerCase();
    lines.push(`- [${time}] ${name} (${c.email ?? "-"}${c.phone ? `, ${c.phone}` : ""}) - ${lead.service_requested ?? "no service specified"}`);
  }
  lines.push(``, `Review: https://crm.cleancarcollective.co.nz/leads`);
  return lines.join("\n");
}

export async function sendDailyApprovalPendingForShop(shop: ShopRecord) {
  const { pending, todayLabel } = await gatherPending(shop);
  if (pending.length === 0) {
    return { sent: false, reason: "no_pending", count: 0 };
  }

  const html = renderHtml(shop, pending, todayLabel);
  const text = renderText(shop, pending, todayLabel);
  const { team_email, from_line: from } = getShopContacts(shop);
  const subject = `⏳ ${pending.length} ${pending.length === 1 ? "lead" : "leads"} waiting on a quote - ${todayLabel}`;

  const postmark = getPostmarkClient();
  const response = await postmark.sendEmail({
    From: from,
    To: team_email,
    Subject: subject,
    TextBody: text,
    HtmlBody: html,
    MessageStream: "booking-emails",
    TrackOpens: false,
    TrackLinks: "None" as never,
    Metadata: {
      shop_id: shop.id,
      template_key: "daily_approval_pending",
    },
  });
  return { sent: true, count: pending.length, providerMessageId: response.MessageID };
}

export async function sendDailyApprovalPendingForAllShops() {
  const supabase = getSupabaseAdminClient();
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, slug, name, timezone");
  if (error || !shops) return { sent: 0, skipped: 0, errors: [error?.message ?? "no shops"] };

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const shop of shops) {
    try {
      const r = await sendDailyApprovalPendingForShop(shop as ShopRecord);
      if (r.sent) sent++;
      else skipped++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${shop.slug}: ${msg}`);
      console.error(`Daily approval-pending failed for ${shop.slug}:`, msg);
    }
  }
  return { sent, skipped, errors };
}
