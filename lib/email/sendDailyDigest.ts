/**
 * Daily team digest email - sent every morning to each shop's team_email.
 *
 * Content covers the previous 24 hours:
 *   - Leads received (with status breakdown)
 *   - Bookings created
 *   - Conversions (won leads, with source attribution)
 *   - Bookings happening today (count + revenue)
 *   - Anything that needs attention (leads stuck in needs_approval)
 *
 * Single template renders for both shops - content scoped per shop.
 */

import { addDays, formatISO, startOfDay } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import type { ShopRecord } from "@/lib/dashboard/types";
import { sendViaGmailSmtp } from "@/lib/email/smtpClient";
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

function formatCurrency(value: number | null) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(value);
}

type DigestStats = {
  shop: ShopRecord;
  leadsReceived: number;
  leadStatusBreakdown: Record<string, number>;
  bookingsCreated: number;
  conversions: number;
  conversionsBySource: Record<string, number>;
  needsApproval: number;
  todayBookings: number;
  todayRevenue: number;
  windowStartIso: string;
  windowEndIso: string;
  todayDateLabel: string;
};

async function gatherDigest(shop: ShopRecord): Promise<DigestStats> {
  const supabase = getSupabaseAdminClient();
  const now = new Date();
  const windowStart = addDays(startOfDay(now), -1).toISOString();
  const windowEnd = startOfDay(now).toISOString();

  // Today in shop's timezone for the "today's bookings" section
  const todayStart = formatInTimeZone(now, shop.timezone, "yyyy-MM-dd'T'00:00:00XXX");
  const tomorrowStart = formatInTimeZone(
    addDays(now, 1),
    shop.timezone,
    "yyyy-MM-dd'T'00:00:00XXX"
  );

  const [leadsRes, bookingsRes, todayRes, needsApprovalRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, status, won_source")
      .eq("shop_id", shop.id)
      .gte("created_at", windowStart)
      .lt("created_at", windowEnd),
    supabase
      .from("bookings")
      .select("id, status, won_source:contact_id, price_estimate")
      .eq("shop_id", shop.id)
      .gte("created_at", windowStart)
      .lt("created_at", windowEnd),
    supabase
      .from("bookings")
      .select("id, status, price_estimate, scheduled_start, contact:contacts(first_name, phone), service_name")
      .eq("shop_id", shop.id)
      .gte("scheduled_start", todayStart)
      .lt("scheduled_start", tomorrowStart)
      .neq("status", "cancelled"),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shop.id)
      .eq("status", "needs_approval"),
  ]);

  const leads = leadsRes.data ?? [];
  const bookings = bookingsRes.data ?? [];
  const todayBookings = todayRes.data ?? [];

  const leadStatusBreakdown: Record<string, number> = {};
  for (const l of leads) {
    const s = (l.status as string) ?? "unknown";
    leadStatusBreakdown[s] = (leadStatusBreakdown[s] ?? 0) + 1;
  }

  const conversionsBySource: Record<string, number> = {};
  let conversions = 0;
  for (const l of leads) {
    if (l.status === "won") {
      conversions++;
      const src = (l.won_source as string) ?? "unknown";
      conversionsBySource[src] = (conversionsBySource[src] ?? 0) + 1;
    }
  }

  const todayRevenue = todayBookings.reduce(
    (sum, b) => sum + ((b.price_estimate as number | null) ?? 0),
    0
  );

  return {
    shop,
    leadsReceived: leads.length,
    leadStatusBreakdown,
    bookingsCreated: bookings.length,
    conversions,
    conversionsBySource,
    needsApproval: needsApprovalRes.count ?? 0,
    todayBookings: todayBookings.length,
    todayRevenue,
    windowStartIso: windowStart,
    windowEndIso: windowEnd,
    todayDateLabel: formatInTimeZone(now, shop.timezone, "EEEE d MMMM"),
  };
}

function statRow(label: string, value: string | number, big = false) {
  return `
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #ede6dc;">
        <span style="font-size: 12px; color: #9e9189; text-transform: uppercase; letter-spacing: 0.05em;">${escapeHtml(label)}</span>
      </td>
      <td align="right" style="padding: 8px 0; border-bottom: 1px solid #ede6dc;">
        <span style="font-size: ${big ? 22 : 16}px; font-weight: ${big ? 700 : 600}; color: #1a1713;">${escapeHtml(String(value))}</span>
      </td>
    </tr>
  `;
}

function renderHtml(stats: DigestStats): string {
  const { shop } = stats;
  const yesterdayLabel = formatInTimeZone(stats.windowStartIso, shop.timezone, "EEEE d MMMM");

  const leadBreakdown =
    Object.keys(stats.leadStatusBreakdown).length === 0
      ? "-"
      : Object.entries(stats.leadStatusBreakdown)
          .map(([s, n]) => `${n} ${s}`)
          .join(", ");

  const sourceBreakdown =
    Object.keys(stats.conversionsBySource).length === 0
      ? ""
      : Object.entries(stats.conversionsBySource)
          .map(([s, n]) => `${n} via ${s}`)
          .join(", ");

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Daily Digest</title>
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
                <h1 class="email-header-title" style="margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; line-height: 1.15;">Daily digest - ${escapeHtml(yesterdayLabel)}</h1>
              </td>
            </tr>

            <tr>
              <td class="email-pad-x" style="background: #ffffff; padding: 32px 36px 28px; border-left: 1px solid #e8e0d6; border-right: 1px solid #e8e0d6;">

                <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.65; color: #5c5148;">
                  Here&apos;s yesterday&apos;s activity and what&apos;s on for today.
                </p>

                <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Yesterday</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-top: 1px solid #ede6dc;">
                  ${statRow("Leads received", stats.leadsReceived, true)}
                  ${statRow("Bookings created", stats.bookingsCreated, true)}
                  ${statRow("Conversions (won)", `${stats.conversions}${sourceBreakdown ? ` - ${sourceBreakdown}` : ""}`)}
                  ${statRow("Lead status breakdown", leadBreakdown)}
                </table>

                <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Today - ${escapeHtml(stats.todayDateLabel)}</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-top: 1px solid #ede6dc;">
                  ${statRow("Bookings on the calendar", stats.todayBookings, true)}
                  ${statRow("Estimated revenue", formatCurrency(stats.todayRevenue))}
                </table>

                ${stats.needsApproval > 0 ? `
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 4px 0 16px; background: #fff8e6; border-left: 3px solid #f4b942; border-radius: 6px;">
                  <tr>
                    <td style="padding: 14px 18px;">
                      <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #a37400;">Needs your attention</p>
                      <p style="margin: 0; font-size: 14px; line-height: 1.55; color: #1a1713;">${stats.needsApproval} ${stats.needsApproval === 1 ? "lead is" : "leads are"} waiting for approval.</p>
                    </td>
                  </tr>
                </table>
                ` : ""}

                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 16px 0;">
                  <tr>
                    <td align="center">
                      <a href="https://crm.cleancarcollective.co.nz/" style="display: inline-block; padding: 12px 28px; background: #1a1713; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 10px;">
                        Open the CRM →
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td bgcolor="#1a1713" class="email-footer email-pad-x" style="background-color: #1a1713; border-radius: 0 0 16px 16px; padding: 22px 36px;">
                <p class="email-footer-title" style="margin: 0 0 2px; font-size: 13px; font-weight: 600; color: #ffffff;">Clean Car Collective CRM</p>
                <p class="email-footer-sub" style="margin: 0; font-size: 12px; color: #7a6f68;">${escapeHtml(shop.name)} - sent automatically each morning</p>
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

function renderText(stats: DigestStats): string {
  const yesterdayLabel = formatInTimeZone(stats.windowStartIso, stats.shop.timezone, "EEEE d MMMM");
  const lines = [
    `${stats.shop.name} - Daily digest for ${yesterdayLabel}`,
    ``,
    `YESTERDAY`,
    `  Leads received: ${stats.leadsReceived}`,
    `  Bookings created: ${stats.bookingsCreated}`,
    `  Conversions: ${stats.conversions}`,
    ``,
    `TODAY (${stats.todayDateLabel})`,
    `  Bookings: ${stats.todayBookings}`,
    `  Estimated revenue: ${formatCurrency(stats.todayRevenue)}`,
    ``,
  ];
  if (stats.needsApproval > 0) {
    lines.push(`⚠️  ${stats.needsApproval} lead${stats.needsApproval === 1 ? "" : "s"} waiting for approval.`);
    lines.push(``);
  }
  lines.push(`Open the CRM: https://crm.cleancarcollective.co.nz/`);
  return lines.join("\n");
}

/**
 * Send the daily digest for a single shop.
 */
export async function sendDailyDigestForShop(shop: ShopRecord) {
  const stats = await gatherDigest(shop);
  const html = renderHtml(stats);
  const text = renderText(stats);

  const { team_email, from_line: from } = getShopContacts(shop);
  const yesterdayLabel = formatInTimeZone(stats.windowStartIso, shop.timezone, "EEE d MMM");
  const subject = `📊 ${shop.name.replace("Clean Car Collective ", "")} - daily digest (${yesterdayLabel})`;

  // Gmail SMTP, not Postmark — internal team email (shop's own address →
  // its own team inbox). External self-addressed sends get rejected by Google.
  const response = await sendViaGmailSmtp({
    From: from,
    To: team_email,
    Subject: subject,
    TextBody: text,
    HtmlBody: html,
    Metadata: {
      shop_id: shop.id,
      template_key: "daily_digest",
    },
  });

  return { providerMessageId: response.MessageID, stats };
}

/**
 * Send the daily digest for every shop in the system. Called by the cron.
 */
export async function sendDailyDigestForAllShops() {
  const supabase = getSupabaseAdminClient();
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, slug, name, timezone");

  if (error || !shops) return { sent: 0, errors: [error?.message ?? "no shops"] };

  const results: Array<{ shop: string; ok: boolean; error?: string }> = [];
  for (const shop of shops) {
    try {
      await sendDailyDigestForShop(shop as ShopRecord);
      results.push({ shop: shop.slug, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ shop: shop.slug, ok: false, error: msg });
      console.error(`Daily digest failed for shop ${shop.slug}:`, msg);
    }
  }

  return {
    sent: results.filter((r) => r.ok).length,
    errors: results.filter((r) => !r.ok).map((r) => `${r.shop}: ${r.error}`),
  };
}
