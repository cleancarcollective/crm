/**
 * Weekly conversion-rate report — sent every Monday morning.
 *
 * Cohort: leads created in the **week before last** (Mon–Sun, 8–14 days ago in
 * shop tz). Two-weeks-ago is deliberate: leads need time to convert. A lead
 * that came in Saturday 2 days ago hasn't had a chance to book; reporting on
 * it now gives a misleading picture. Two weeks gives every lead at least
 * 7–14 days to move down the funnel.
 *
 * Funnel stages tracked per lead:
 *   1. Lead received
 *   2. First email sent (auto-respond or manual)
 *   3. Email opened (any open event from Postmark)
 *   4. Email clicked (any click event)
 *   5. Booked — auto-detected: any booking for the lead's contact created
 *      within CONVERSION_WINDOW_DAYS after the lead. We don't rely on
 *      lead.status="won" because that's never set in practice.
 *   6. Booking completed (booking.status = "completed")
 *
 * Plus per-source conversion rates so we can see which channel is dragging
 * the average down.
 */

import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import type { ShopRecord } from "@/lib/dashboard/types";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { EMAIL_HEAD_HARDENING } from "@/lib/email/sharedEmailStyles";
import { getShopContacts } from "@/lib/email/shopContacts";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

/**
 * How long after a lead arrives we'll still credit a resulting booking back
 * to that lead. Detail bookings are usually impulse — most convert within
 * 1–2 weeks. 30 days is generous but safe.
 */
export const CONVERSION_WINDOW_DAYS = 30;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pct(num: number, denom: number) {
  if (denom === 0) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(value);
}

/**
 * Compute Mon–Sun cohort window (the week before last) in shop timezone.
 * Returns ISO strings with the shop's UTC offset baked in so Postgres compares
 * correctly.
 */
function getCohortWindow(now: Date, tz: string) {
  // ISO day-of-week: 1=Mon..7=Sun
  const dayOfWeek = Number(formatInTimeZone(now, tz, "i"));
  const daysSinceMonday = dayOfWeek - 1;

  // "Today" anchor in shop tz, then walk back to this Monday, then -7 / -14.
  const todayDateStr = formatInTimeZone(now, tz, "yyyy-MM-dd");
  const anchor = new Date(`${todayDateStr}T00:00:00Z`);
  const thisMonday = addDays(anchor, -daysSinceMonday);
  const cohortStart = addDays(thisMonday, -14); // Mon 14 days ago
  const cohortEnd = addDays(thisMonday, -7); // Mon 7 days ago (exclusive)

  const offset = formatInTimeZone(now, tz, "XXX");
  const startDate = formatInTimeZone(cohortStart, tz, "yyyy-MM-dd");
  const endDate = formatInTimeZone(cohortEnd, tz, "yyyy-MM-dd");

  return {
    cohortStartIso: `${startDate}T00:00:00${offset}`,
    cohortEndIso: `${endDate}T00:00:00${offset}`,
    label: `${formatInTimeZone(cohortStart, tz, "EEE d MMM")} – ${formatInTimeZone(addDays(cohortEnd, -1), tz, "EEE d MMM")}`,
  };
}

type FunnelTotals = {
  leads: number;
  firstEmailSent: number;
  opened: number;
  clicked: number;
  booked: number;
  completed: number;
  revenue: number;
};

type SourceBreakdown = Record<string, { leads: number; booked: number }>;

type ConversionStats = {
  shop: ShopRecord;
  cohortLabel: string;
  cohortStartIso: string;
  cohortEndIso: string;
  totals: FunnelTotals;
  sources: SourceBreakdown;
};

/**
 * Compute funnel stats for any lead-cohort window. Used by the weekly cron
 * (window = "the week before last") and the one-off snapshot script
 * (arbitrary windows).
 */
export async function gatherConversionStats(args: {
  shop: ShopRecord;
  cohortStartIso: string;
  cohortEndIso: string;
  cohortLabel: string;
}): Promise<ConversionStats> {
  const { shop, cohortStartIso, cohortEndIso, cohortLabel } = args;
  const supabase = getSupabaseAdminClient();

  // Pull leads + their email_messages + email_events in one nested query.
  // PostgREST supports two levels of relationship nesting.
  const { data: leadsData, error: leadsErr } = await supabase
    .from("leads")
    .select(`
      id, source, status, contact_id, created_at,
      email_messages ( id, status, email_events ( event_type ) )
    `)
    .eq("shop_id", shop.id)
    .gte("created_at", cohortStartIso)
    .lt("created_at", cohortEndIso);

  if (leadsErr) throw leadsErr;
  const leads = leadsData ?? [];

  // Pull every booking for any contact in the cohort that was created after
  // the cohort start (we only credit forward). Conversion-window check happens
  // per-lead below.
  const contactIds = leads.map((l) => l.contact_id).filter((v): v is string => Boolean(v));

  let bookings: Array<{
    contact_id: string | null;
    status: string;
    price_estimate: number | null;
    created_at: string;
  }> = [];
  if (contactIds.length > 0) {
    const { data: bookingsData } = await supabase
      .from("bookings")
      .select("contact_id, status, price_estimate, created_at")
      .eq("shop_id", shop.id)
      .in("contact_id", contactIds)
      .gte("created_at", cohortStartIso);
    bookings = bookingsData ?? [];
  }

  // Index bookings by contact for O(1) lookup
  const bookingsByContact = new Map<string, typeof bookings>();
  for (const b of bookings) {
    if (!b.contact_id) continue;
    const arr = bookingsByContact.get(b.contact_id) ?? [];
    arr.push(b);
    bookingsByContact.set(b.contact_id, arr);
  }

  const totals: FunnelTotals = {
    leads: leads.length,
    firstEmailSent: 0,
    opened: 0,
    clicked: 0,
    booked: 0,
    completed: 0,
    revenue: 0,
  };

  const sources: SourceBreakdown = {};
  const conversionWindowMs = CONVERSION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  for (const lead of leads) {
    const src = (lead.source as string) || "unknown";
    sources[src] ??= { leads: 0, booked: 0 };
    sources[src].leads++;

    const messages = (lead.email_messages ?? []) as Array<{
      status: string;
      email_events: Array<{ event_type: string }> | null;
    }>;

    const sentMsg = messages.find((m) => m.status === "sent");
    if (sentMsg) totals.firstEmailSent++;

    const allEvents = messages.flatMap((m) => m.email_events ?? []);
    if (allEvents.some((e) => e.event_type === "open")) totals.opened++;
    if (allEvents.some((e) => e.event_type === "click")) totals.clicked++;

    // Auto-detect conversion: any booking for this contact, created after
    // the lead, within the conversion window.
    if (!lead.contact_id) continue;
    const leadCreatedMs = new Date(lead.created_at as string).getTime();
    const contactBookings = bookingsByContact.get(lead.contact_id) ?? [];

    const matchingBooking = contactBookings.find((b) => {
      const bookedMs = new Date(b.created_at).getTime();
      return bookedMs >= leadCreatedMs && bookedMs <= leadCreatedMs + conversionWindowMs;
    });

    if (matchingBooking) {
      totals.booked++;
      sources[src].booked++;
      if (matchingBooking.status === "completed") {
        totals.completed++;
        totals.revenue += matchingBooking.price_estimate ?? 0;
      }
    }
  }

  return {
    shop,
    cohortLabel,
    cohortStartIso,
    cohortEndIso,
    totals,
    sources,
  };
}

async function gatherStats(shop: ShopRecord): Promise<ConversionStats> {
  const now = new Date();
  const { cohortStartIso, cohortEndIso, label } = getCohortWindow(now, shop.timezone);
  return gatherConversionStats({ shop, cohortStartIso, cohortEndIso, cohortLabel: label });
}

export { getCohortWindow };

function funnelRow(label: string, count: number, leadsTotal: number, stepFromCount: number | null) {
  const overall = pct(count, leadsTotal);
  const step = stepFromCount === null ? "—" : pct(count, stepFromCount);
  return `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #ede6dc;">
        <span style="font-size: 14px; color: #1a1713;">${escapeHtml(label)}</span>
      </td>
      <td align="right" style="padding: 10px 0; border-bottom: 1px solid #ede6dc;">
        <span style="font-size: 16px; font-weight: 700; color: #1a1713;">${count}</span>
      </td>
      <td align="right" style="padding: 10px 12px 10px 0; border-bottom: 1px solid #ede6dc;">
        <span style="font-size: 13px; color: #5c5148;">${overall}</span>
      </td>
      <td align="right" style="padding: 10px 0; border-bottom: 1px solid #ede6dc;">
        <span style="font-size: 13px; color: #9e9189;">${step}</span>
      </td>
    </tr>
  `;
}

function sourceRow(source: string, leads: number, booked: number) {
  const rate = pct(booked, leads);
  return `
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #ede6dc;">
        <span style="font-size: 13px; color: #1a1713; text-transform: capitalize;">${escapeHtml(source)}</span>
      </td>
      <td align="right" style="padding: 8px 0; border-bottom: 1px solid #ede6dc;">
        <span style="font-size: 13px; color: #5c5148;">${leads} lead${leads === 1 ? "" : "s"}</span>
      </td>
      <td align="right" style="padding: 8px 0; border-bottom: 1px solid #ede6dc;">
        <span style="font-size: 13px; color: #5c5148;">${booked} booked</span>
      </td>
      <td align="right" style="padding: 8px 0; border-bottom: 1px solid #ede6dc;">
        <span style="font-size: 14px; font-weight: 600; color: #1a1713;">${rate}</span>
      </td>
    </tr>
  `;
}

/**
 * Pick the funnel stage where the biggest drop happens — surfaces the
 * "where you're losing them" insight at the top of the email.
 */
function biggestDrop(t: FunnelTotals): { from: string; to: string; lostPct: number } | null {
  const stages: Array<{ name: string; count: number }> = [
    { name: "Leads received", count: t.leads },
    { name: "First email sent", count: t.firstEmailSent },
    { name: "Email opened", count: t.opened },
    { name: "Email clicked", count: t.clicked },
    { name: "Booked", count: t.booked },
  ];
  let worst: { from: string; to: string; lostPct: number } | null = null;
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1]!;
    const cur = stages[i]!;
    if (prev.count === 0) continue;
    const lost = (prev.count - cur.count) / prev.count;
    if (lost > 0 && (worst === null || lost > worst.lostPct)) {
      worst = { from: prev.name, to: cur.name, lostPct: lost };
    }
  }
  return worst;
}

function renderHtml(stats: ConversionStats): string {
  const { shop, totals, sources, cohortLabel } = stats;
  const drop = biggestDrop(totals);

  const sourceEntries = Object.entries(sources).sort(([, a], [, b]) => b.leads - a.leads);

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Weekly conversion report</title>
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
                <h1 class="email-header-title" style="margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; line-height: 1.15;">Weekly conversion report</h1>
                <p style="margin: 8px 0 0; font-size: 13px; color: #9e9189;">Cohort: ${escapeHtml(cohortLabel)}</p>
              </td>
            </tr>

            <tr>
              <td class="email-pad-x" style="background: #ffffff; padding: 32px 36px 28px; border-left: 1px solid #e8e0d6; border-right: 1px solid #e8e0d6;">

                ${totals.leads === 0 ? `
                <p style="margin: 0; font-size: 15px; line-height: 1.65; color: #5c5148;">
                  No leads were received during this cohort. Nothing to report.
                </p>
                ` : `

                <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">The headline</p>
                <p style="margin: 0 0 24px; font-size: 22px; font-weight: 700; color: #1a1713; line-height: 1.3;">
                  ${totals.booked} of ${totals.leads} leads booked &mdash; ${pct(totals.booked, totals.leads)} conversion
                </p>

                ${drop ? `
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 24px; background: #fff8e6; border-left: 3px solid #f4b942; border-radius: 6px;">
                  <tr>
                    <td style="padding: 14px 18px;">
                      <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #a37400;">Biggest drop-off</p>
                      <p style="margin: 0; font-size: 14px; line-height: 1.55; color: #1a1713;">
                        <strong>${Math.round(drop.lostPct * 100)}% lost</strong> between &ldquo;${escapeHtml(drop.from)}&rdquo; and &ldquo;${escapeHtml(drop.to)}&rdquo;.
                      </p>
                    </td>
                  </tr>
                </table>
                ` : ""}

                <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">Funnel</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-top: 1px solid #ede6dc;">
                  <tr>
                    <td style="padding: 6px 0 4px;"><span style="font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #9e9189;">Stage</span></td>
                    <td align="right" style="padding: 6px 0 4px;"><span style="font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #9e9189;">Count</span></td>
                    <td align="right" style="padding: 6px 12px 4px 0;"><span style="font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #9e9189;">% of leads</span></td>
                    <td align="right" style="padding: 6px 0 4px;"><span style="font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #9e9189;">Step</span></td>
                  </tr>
                  ${funnelRow("Leads received", totals.leads, totals.leads, null)}
                  ${funnelRow("First email sent", totals.firstEmailSent, totals.leads, totals.leads)}
                  ${funnelRow("Email opened", totals.opened, totals.leads, totals.firstEmailSent)}
                  ${funnelRow("Email clicked", totals.clicked, totals.leads, totals.opened)}
                  ${funnelRow("Booked", totals.booked, totals.leads, totals.leads)}
                  ${funnelRow("Completed (revenue)", totals.completed, totals.leads, totals.booked)}
                </table>

                ${totals.completed > 0 ? `
                <p style="margin: 0 0 24px; font-size: 14px; color: #5c5148;">
                  Revenue from completed bookings in this cohort: <strong style="color: #1a1713;">${escapeHtml(formatCurrency(totals.revenue))}</strong>
                </p>
                ` : ""}

                ${sourceEntries.length > 0 ? `
                <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9e9189;">By source</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-top: 1px solid #ede6dc;">
                  ${sourceEntries.map(([src, v]) => sourceRow(src, v.leads, v.booked)).join("")}
                </table>
                ` : ""}

                <p style="margin: 0; font-size: 13px; color: #9e9189; line-height: 1.6;">
                  Cohort = leads created in the week before last. We wait a week so leads have a fair chance to convert before being counted.
                </p>
                `}

                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0 0;">
                  <tr>
                    <td align="center">
                      <a href="https://crm.cleancarcollective.co.nz/analytics" style="display: inline-block; padding: 12px 28px; background: #1a1713; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 10px;">
                        Open analytics →
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td bgcolor="#1a1713" class="email-footer email-pad-x" style="background-color: #1a1713; border-radius: 0 0 16px 16px; padding: 22px 36px;">
                <p class="email-footer-title" style="margin: 0 0 2px; font-size: 13px; font-weight: 600; color: #ffffff;">Clean Car Collective CRM</p>
                <p class="email-footer-sub" style="margin: 0; font-size: 12px; color: #7a6f68;">${escapeHtml(shop.name)} — sent every Monday morning</p>
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

function renderText(stats: ConversionStats): string {
  const { totals, cohortLabel, sources } = stats;
  const lines: string[] = [
    `${stats.shop.name} — Weekly conversion report`,
    `Cohort: ${cohortLabel}`,
    ``,
  ];
  if (totals.leads === 0) {
    lines.push(`No leads received during this cohort.`);
    return lines.join("\n");
  }
  lines.push(
    `${totals.booked} of ${totals.leads} leads booked — ${pct(totals.booked, totals.leads)} conversion`,
    ``,
    `FUNNEL`,
    `  Leads received:     ${totals.leads}`,
    `  First email sent:   ${totals.firstEmailSent} (${pct(totals.firstEmailSent, totals.leads)})`,
    `  Email opened:       ${totals.opened} (${pct(totals.opened, totals.leads)})`,
    `  Email clicked:      ${totals.clicked} (${pct(totals.clicked, totals.leads)})`,
    `  Booked:             ${totals.booked} (${pct(totals.booked, totals.leads)})`,
    `  Completed:          ${totals.completed} — revenue ${formatCurrency(totals.revenue)}`,
    ``,
  );
  const drop = biggestDrop(totals);
  if (drop) {
    lines.push(
      `Biggest drop-off: ${Math.round(drop.lostPct * 100)}% lost between "${drop.from}" and "${drop.to}".`,
      ``
    );
  }
  const sourceEntries = Object.entries(sources).sort(([, a], [, b]) => b.leads - a.leads);
  if (sourceEntries.length > 0) {
    lines.push(`BY SOURCE`);
    for (const [src, v] of sourceEntries) {
      lines.push(`  ${src}: ${v.booked} booked / ${v.leads} leads — ${pct(v.booked, v.leads)}`);
    }
    lines.push(``);
  }
  lines.push(`Open analytics: https://crm.cleancarcollective.co.nz/analytics`);
  return lines.join("\n");
}

export async function sendWeeklyConversionReportForShop(shop: ShopRecord) {
  const stats = await gatherStats(shop);
  const html = renderHtml(stats);
  const text = renderText(stats);

  const { team_email, from_line: from } = getShopContacts(shop);
  const subject = `📈 ${shop.name.replace("Clean Car Collective ", "")} — weekly conversion (${stats.cohortLabel})`;

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
      template_key: "weekly_conversion_report",
    },
  });

  return { providerMessageId: response.MessageID, stats };
}

export async function sendWeeklyConversionReportForAllShops() {
  const supabase = getSupabaseAdminClient();
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, slug, name, timezone");

  if (error || !shops) return { sent: 0, errors: [error?.message ?? "no shops"] };

  const results: Array<{ shop: string; ok: boolean; error?: string }> = [];
  for (const shop of shops) {
    try {
      await sendWeeklyConversionReportForShop(shop as ShopRecord);
      results.push({ shop: shop.slug, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ shop: shop.slug, ok: false, error: msg });
      console.error(`Weekly conversion report failed for shop ${shop.slug}:`, msg);
    }
  }

  return {
    sent: results.filter((r) => r.ok).length,
    errors: results.filter((r) => !r.ok).map((r) => `${r.shop}: ${r.error}`),
  };
}
