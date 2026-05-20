/**
 * GET /api/cron/health-alert
 *
 * Daily cron. For each active shop, runs the same checks the
 * /settings/health page shows. If any check is in 'error' state, emails
 * the shop's team_email with the details so a silent failure can't hide
 * for 26 days again (see the 2026-05-20 stale-SMS incident).
 *
 * Warnings (amber) are NOT emailed - they're informational and would
 * train staff to ignore the alert. Only red.
 *
 * Auth: same dual-mode as other crons.
 */

import { NextResponse } from "next/server";

import { runChecks } from "@/lib/health/checks";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { getShopContacts } from "@/lib/email/shopContacts";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { ShopRecord } from "@/lib/dashboard/types";

function isAuthorized(request: Request) {
  const vercelCron = request.headers.get("x-vercel-cron");
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (vercelCron === "1") return true;
  if (!cronSecret) throw new Error("Missing required environment variable: CRON_SECRET");
  return authHeader === `Bearer ${cronSecret}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const CRM_BASE_URL = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, slug, name, timezone");
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const results: Array<{ shop: string; errors: number; alerted: boolean }> = [];

  for (const shop of (shops ?? []) as ShopRecord[]) {
    const checks = await runChecks(shop.id);
    const errors = checks.filter((c) => c.status === "error");

    if (errors.length === 0) {
      results.push({ shop: shop.slug, errors: 0, alerted: false });
      continue;
    }

    try {
      await sendHealthAlertEmail(shop, errors);
      results.push({ shop: shop.slug, errors: errors.length, alerted: true });
    } catch (err) {
      console.error("Health alert email failed", { shop: shop.slug, err });
      results.push({ shop: shop.slug, errors: errors.length, alerted: false });
    }
  }

  return NextResponse.json({ success: true, results });
}

async function sendHealthAlertEmail(
  shop: ShopRecord,
  errors: Array<{ name: string; message: string; details?: string; category: string }>
) {
  const { team_email, from_line } = getShopContacts(shop);
  const subject = `[CRM Health] ${errors.length} issue${errors.length === 1 ? "" : "s"} need attention - ${shop.name}`;
  const healthUrl = `${CRM_BASE_URL}/settings/health`;

  const textLines = [
    `${errors.length} health check${errors.length === 1 ? " is" : "s are"} red for ${shop.name}:`,
    "",
    ...errors.map((e) => `[${e.category}] ${e.name}: ${e.message}${e.details ? `\n  ${e.details.replaceAll("\n", "\n  ")}` : ""}`),
    "",
    `Full dashboard: ${healthUrl}`,
  ];

  const html = `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#E5E4E2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#E5E4E2;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;">
          <tr>
            <td style="background:#1a1713;padding:24px 32px;border-radius:16px 16px 0 0;">
              <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#c9c5c0;">${escapeHtml(shop.name)} - CRM health</p>
              <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.25;">${errors.length} issue${errors.length === 1 ? "" : "s"} need attention</h1>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:24px 32px;border-left:1px solid #e8e0d6;border-right:1px solid #e8e0d6;">
              ${errors
                .map(
                  (e) => `
                <div style="margin:0 0 16px;padding:12px 14px;border-left:3px solid #c0392b;background:#fdecea;border-radius:6px;">
                  <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#7a6f68;">${escapeHtml(e.category)}</p>
                  <p style="margin:0 0 6px;font-size:15px;font-weight:600;color:#1a1713;">${escapeHtml(e.name)}</p>
                  <p style="margin:0;font-size:14px;color:#1a1713;">${escapeHtml(e.message)}</p>
                  ${e.details ? `<pre style="margin:8px 0 0;padding:8px;background:#ffffff;border:1px solid #e8e0d6;border-radius:4px;font-size:12px;color:#5c5148;white-space:pre-wrap;">${escapeHtml(e.details)}</pre>` : ""}
                </div>`
                )
                .join("")}
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0 4px;">
                <tr><td align="center">
                  <a href="${escapeHtml(healthUrl)}" style="display:inline-block;padding:12px 24px;background:#1a4d2e;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;">Open health dashboard</a>
                </td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#1a1713;padding:16px 32px;border-radius:0 0 16px 16px;">
              <p style="margin:0;font-size:12px;color:#7a6f68;">${escapeHtml(shop.name)} CRM - daily health check. You're only getting this because something needs attention.</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`.trim();

  await getPostmarkClient().sendEmail({
    From: from_line,
    To: team_email,
    Subject: subject,
    TextBody: textLines.join("\n"),
    HtmlBody: html,
    MessageStream: "booking-emails",
    TrackOpens: false,
    TrackLinks: "None" as never,
    Metadata: { shop_id: shop.id, template_key: "health_alert" },
  });
}
