/**
 * Email a "pending enquiries" report (real customers from last 90 days who
 * haven't received a quote) to each shop's team_email. On-demand, not on a
 * cron — fire it via /api/admin/pending-enquiries-report when you want it.
 *
 * Same filtering as scripts/list-pending-enquiries.ts:
 *   - excludes @cleancarcollective.co.nz, @example.com, @example.org
 *   - excludes Max Tebbs (developer test account)
 *   - excludes names containing "test" or "check"
 *   - excludes sources containing "test" or starting with "bridge-"
 *   - excludes contacts who already have a booking (phone-ins, etc.)
 *   - skips leads with malformed email (no @)
 */

import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import type { ShopRecord } from "@/lib/dashboard/types";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { EMAIL_HEAD_HARDENING } from "@/lib/email/sharedEmailStyles";
import { getShopContacts } from "@/lib/email/shopContacts";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const LOOKBACK_DAYS = 90;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const isConfirmation = (s: string) => s.startsWith("We've received your enquiry");
const isTeamNotif = (s: string) => s.startsWith("New lead:");

function isInternalOrTest(args: { email: string | null; firstName: string | null; lastName: string | null; source: string | null }) {
  const email = (args.email ?? "").toLowerCase();
  const fullName = [args.firstName, args.lastName].filter(Boolean).join(" ").toLowerCase();
  const source = (args.source ?? "").toLowerCase();
  if (!email.includes("@")) return true;
  if (email.endsWith("@cleancarcollective.co.nz")) return true;
  if (email.endsWith("@example.com") || email.endsWith("@example.org")) return true;
  if (email === "tebbs.max@gmail.com") return true;
  if (fullName.includes("max tebbs")) return true;
  if (fullName.includes("test")) return true;
  if (fullName.includes("check")) return true;
  if (source.includes("test")) return true;
  if (source.startsWith("bridge-")) return true;
  return false;
}

type PendingRow = {
  leadId: string;
  leadCreatedAt: string;
  daysWaiting: number;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  serviceRequested: string | null;
  vehicleLabel: string;
  source: string;
  status: string;
};

async function gatherPendingForShop(shop: ShopRecord): Promise<PendingRow[]> {
  const supabase = getSupabaseAdminClient();
  const cutoffIso = addDays(new Date(), -LOOKBACK_DAYS).toISOString();
  const now = Date.now();

  const { data: leadsData, error } = await supabase
    .from("leads")
    .select(`
      id, source, status, contact_id, created_at, service_requested,
      contact:contacts(first_name, last_name, email, phone),
      vehicle:vehicles(year, make, model),
      email_messages(id, subject, status, sent_at)
    `)
    .eq("shop_id", shop.id)
    .gte("created_at", cutoffIso)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const leads = (leadsData ?? []) as any[];

  // Exclude contacts who have any booking in our system
  const contactIds = leads.map((l) => l.contact_id).filter(Boolean) as string[];
  const bookedContactIds = new Set<string>();
  if (contactIds.length > 0) {
    const { data: bookingsData } = await supabase
      .from("bookings")
      .select("contact_id")
      .eq("shop_id", shop.id)
      .in("contact_id", contactIds);
    for (const b of bookingsData ?? []) {
      if (b.contact_id) bookedContactIds.add(b.contact_id);
    }
  }

  const rows: PendingRow[] = [];
  for (const l of leads) {
    if (l.contact_id && bookedContactIds.has(l.contact_id)) continue;
    const c = l.contact ?? {};
    if (isInternalOrTest({
      email: c.email ?? null,
      firstName: c.first_name ?? null,
      lastName: c.last_name ?? null,
      source: l.source ?? null,
    })) continue;

    const sentEmails = (l.email_messages ?? []).filter((m: any) => m.status === "sent" && m.sent_at);
    const hasQuote = sentEmails.some(
      (m: any) => !isConfirmation(m.subject ?? "") && !isTeamNotif(m.subject ?? "")
    );
    if (hasQuote) continue;

    const v = l.vehicle ?? {};
    rows.push({
      leadId: l.id,
      leadCreatedAt: l.created_at,
      daysWaiting: Math.floor((now - new Date(l.created_at).getTime()) / (24 * 60 * 60 * 1000)),
      contactName: [c.first_name, c.last_name].filter(Boolean).join(" ") || "—",
      contactEmail: c.email ?? "—",
      contactPhone: c.phone ?? null,
      serviceRequested: l.service_requested,
      vehicleLabel: [v.year, v.make, v.model].filter(Boolean).join(" ") || "—",
      source: l.source ?? "unknown",
      status: l.status ?? "—",
    });
  }
  return rows;
}

function renderRow(r: PendingRow, shop: ShopRecord) {
  const dateLabel = formatInTimeZone(r.leadCreatedAt, shop.timezone, "d MMM HH:mm");
  return `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #ede6dc; vertical-align: top;">
        <p style="margin: 0 0 2px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #9e9189;">${escapeHtml(dateLabel)} · ${r.daysWaiting}d waiting</p>
        <p style="margin: 0 0 4px; font-size: 15px; font-weight: 600; color: #1a1713;">${escapeHtml(r.contactName)}</p>
        <p style="margin: 0 0 4px; font-size: 13px; color: #5c5148;">
          <a href="mailto:${escapeHtml(r.contactEmail)}" style="color: #5c5148; text-decoration: underline;">${escapeHtml(r.contactEmail)}</a>${r.contactPhone ? ` · <a href="tel:${escapeHtml(r.contactPhone)}" style="color: #5c5148; text-decoration: underline;">${escapeHtml(r.contactPhone)}</a>` : ""}
        </p>
        <p style="margin: 0; font-size: 13px; color: #5c5148;">
          ${r.serviceRequested ? escapeHtml(r.serviceRequested) : "—"}${r.vehicleLabel !== "—" ? ` · ${escapeHtml(r.vehicleLabel)}` : ""}
        </p>
      </td>
    </tr>
  `;
}

function renderHtml(shop: ShopRecord, rows: PendingRow[]) {
  // Sort newest-first within the email
  rows.sort((a, b) => new Date(b.leadCreatedAt).getTime() - new Date(a.leadCreatedAt).getTime());
  const body = rows.length === 0
    ? `<p style="margin: 0; font-size: 15px; color: #5c5148;">Nothing pending — clean slate.</p>`
    : rows.map((r) => renderRow(r, shop)).join("");

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pending enquiries</title>
    ${EMAIL_HEAD_HARDENING}
  </head>
  <body style="margin: 0; padding: 0; background-color: #E5E4E2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #E5E4E2; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="email-card" style="max-width: 640px;">

            <tr>
              <td bgcolor="#1a1713" class="email-header email-pad-x" style="background-color: #1a1713; background-image: linear-gradient(160deg, #1a1713 0%, #0d0c0b 100%); border-radius: 16px 16px 0 0; padding: 32px 36px;">
                <p class="email-header-eyebrow" style="margin: 0 0 6px; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #c9c5c0;">${escapeHtml(shop.name)}</p>
                <h1 class="email-header-title" style="margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; line-height: 1.15;">${rows.length} ${rows.length === 1 ? "enquiry" : "enquiries"} waiting on a quote</h1>
                <p style="margin: 8px 0 0; font-size: 13px; color: #9e9189;">From the last ${LOOKBACK_DAYS} days · real customers only · already-booked excluded</p>
              </td>
            </tr>

            <tr>
              <td class="email-pad-x" style="background: #ffffff; padding: 28px 36px 28px; border-left: 1px solid #e8e0d6; border-right: 1px solid #e8e0d6;">
                <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #5c5148;">
                  These are real customers who enquired and never received a quote from us. Every day's delay is one fewer chance to win the job. Sorted newest-first below.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top: 1px solid #ede6dc;">
                  ${body}
                </table>

                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0 0;">
                  <tr>
                    <td align="center">
                      <a href="https://crm.cleancarcollective.co.nz/leads" style="display: inline-block; padding: 12px 28px; background: #1a1713; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 10px;">
                        Open leads in CRM →
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td bgcolor="#1a1713" class="email-footer email-pad-x" style="background-color: #1a1713; border-radius: 0 0 16px 16px; padding: 22px 36px;">
                <p class="email-footer-title" style="margin: 0 0 2px; font-size: 13px; font-weight: 600; color: #ffffff;">Clean Car Collective CRM</p>
                <p class="email-footer-sub" style="margin: 0; font-size: 12px; color: #7a6f68;">${escapeHtml(shop.name)} — generated on demand</p>
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

function renderText(shop: ShopRecord, rows: PendingRow[]) {
  if (rows.length === 0) return `${shop.name} — nothing pending. Clean slate.`;
  rows.sort((a, b) => new Date(b.leadCreatedAt).getTime() - new Date(a.leadCreatedAt).getTime());
  const lines = [
    `${shop.name} — ${rows.length} ${rows.length === 1 ? "enquiry" : "enquiries"} waiting on a quote (last ${LOOKBACK_DAYS} days)`,
    ``,
  ];
  for (const r of rows) {
    const date = formatInTimeZone(r.leadCreatedAt, shop.timezone, "d MMM HH:mm");
    lines.push(`- [${date}, ${r.daysWaiting}d waiting] ${r.contactName} (${r.contactEmail}${r.contactPhone ? `, ${r.contactPhone}` : ""}) — ${r.serviceRequested ?? "no service specified"}${r.vehicleLabel !== "—" ? ` · ${r.vehicleLabel}` : ""}`);
  }
  lines.push(``, `Open: https://crm.cleancarcollective.co.nz/leads`);
  return lines.join("\n");
}

export async function sendPendingEnquiriesReportForShop(shop: ShopRecord) {
  const rows = await gatherPendingForShop(shop);
  const html = renderHtml(shop, rows);
  const text = renderText(shop, rows);
  const { team_email, from_line: from } = getShopContacts(shop);
  const subject = `📋 ${rows.length} ${rows.length === 1 ? "enquiry" : "enquiries"} waiting on a quote — ${shop.name.replace("Clean Car Collective ", "")}`;

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
      template_key: "pending_enquiries_report",
    },
  });
  return { count: rows.length, providerMessageId: response.MessageID };
}

export async function sendPendingEnquiriesReportForAllShops() {
  const supabase = getSupabaseAdminClient();
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, slug, name, timezone");
  if (error || !shops) return { sent: 0, errors: [error?.message ?? "no shops"] };

  const results: Array<{ shop: string; count: number; ok: boolean; error?: string }> = [];
  for (const shop of shops) {
    try {
      const r = await sendPendingEnquiriesReportForShop(shop as ShopRecord);
      results.push({ shop: shop.slug, count: r.count, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ shop: shop.slug, count: 0, ok: false, error: msg });
      console.error(`Pending enquiries report failed for ${shop.slug}:`, msg);
    }
  }
  return {
    sent: results.filter((r) => r.ok).length,
    counts: results.filter((r) => r.ok).map((r) => `${r.shop}: ${r.count}`),
    errors: results.filter((r) => !r.ok).map((r) => `${r.shop}: ${r.error}`),
  };
}
