/**
 * Google Ads offline conversion export.
 *
 * Posts newly-booked jobs (with their originating lead's gclid) to a Google
 * Apps Script web app, which appends them to a Google Sheet. The Sheet is
 * imported into Google Ads on a schedule via the "Schedule" feature on the
 * conversion-import page — that gives Google Ads the booking value for each
 * ad click, so Smart Bidding can optimize for revenue.
 *
 * Why "booked" not "completed":
 *   - Speed of signal. Smart Bidding learns fastest from quick feedback.
 *     Detailing jobs book 1-3 weeks ahead, so waiting for "completed" means
 *     Google sees the conversion weeks after the click — too slow.
 *   - Industry norm. Most service businesses report at booking, not at
 *     job completion.
 *   - Cancellations are handled later via conversion adjustments
 *     (a Google Ads feature that subtracts the value retroactively).
 *     Not built yet; ~5-10% noise is acceptable for v1.
 *
 * Why a Google Apps Script middleman instead of the official Google Ads API:
 *   - The Google Ads API requires a developer-token approval process that
 *     takes days/weeks. Apps Script is instant.
 *   - The data shape Google Ads ingests from a Sheet is the same format
 *     we'd POST to the API — when we eventually swap to direct API, only the
 *     transport changes.
 *   - Sheets are inspectable. If something looks wrong we open the sheet
 *     and look at the rows, no logs or trace IDs to dig through.
 *
 * Schedule: every morning, this exports any booking created in the last
 * 24 hours. Idempotent — we tag each row with the booking id and the Apps
 * Script de-dupes.
 */

import { addDays } from "date-fns";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type ExportRow = {
  booking_id: string;
  shop_slug: string;
  conversion_action: string; // Google Ads conversion action name
  conversion_time: string; // ISO 8601 with timezone offset
  value: number;
  currency: string;
  // One of these will be set, others null. Apps Script picks the right
  // column to write to.
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  // Hashed email for Enhanced Conversions for Leads (fallback when no gclid)
  email_sha256: string | null;
};

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Pull bookings that were CREATED in [windowStart, windowEnd) and turn them
 * into export rows. Joins to the booking's contact's most-recent lead at
 * or before the booking to find the gclid.
 *
 * We use booking creation (not completion) because Smart Bidding learns
 * faster from quick feedback. Cancelled bookings will be handled separately
 * via Google Ads conversion adjustments (not yet built — v2).
 */
async function buildExportRows(args: {
  windowStartIso: string;
  windowEndIso: string;
}): Promise<ExportRow[]> {
  const supabase = getSupabaseAdminClient();

  // Bookings created in the window. We exclude cancelled ones up-front —
  // a same-day book-and-cancel shouldn't be reported at all. For cancellations
  // that happen later than the export window, we'll need adjustment uploads.
  const { data: bookings, error: bookingsErr } = await supabase
    .from("bookings")
    .select(`
      id, shop_id, contact_id, price_estimate, created_at, scheduled_start, status,
      gclid, gbraid, wbraid
    `)
    .neq("status", "cancelled")
    .gte("created_at", args.windowStartIso)
    .lt("created_at", args.windowEndIso);

  if (bookingsErr) throw bookingsErr;
  if (!bookings || bookings.length === 0) return [];

  // Fetch shop slugs separately. The PostgREST embedded `shop:shops(slug)`
  // join sometimes returns null on rows where it shouldn't — saw 4-of-5
  // Wellington bookings come back with no slug despite having a valid
  // shop_id. Explicit lookup is reliable.
  const { data: shops } = await supabase
    .from("shops")
    .select("id, slug");
  const slugByShopId = new Map<string, string>();
  for (const s of shops ?? []) {
    if (s.id && s.slug) slugByShopId.set(s.id as string, s.slug as string);
  }

  const contactIds = Array.from(
    new Set(bookings.map((b) => b.contact_id).filter((v): v is string => Boolean(v)))
  );
  if (contactIds.length === 0) return [];

  // 2. For each contact, find their most recent lead at or before the
  //    booking — that's the lead the booking attributes to. We pull all
  //    leads for these contacts with attribution data and pick in JS.
  const { data: leads, error: leadsErr } = await supabase
    .from("leads")
    .select("id, contact_id, created_at, gclid, gbraid, wbraid")
    .in("contact_id", contactIds)
    .order("created_at", { ascending: false });

  if (leadsErr) throw leadsErr;

  // 3. Pull contact emails for Enhanced Conversions fallback.
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, email")
    .in("id", contactIds);

  const emailByContact = new Map<string, string | null>();
  for (const c of contacts ?? []) {
    emailByContact.set(c.id as string, (c.email as string | null) ?? null);
  }

  // Index leads by contact, sorted newest-first
  const leadsByContact = new Map<string, typeof leads>();
  for (const lead of leads ?? []) {
    if (!lead.contact_id) continue;
    const arr = leadsByContact.get(lead.contact_id as string) ?? [];
    arr.push(lead);
    leadsByContact.set(lead.contact_id as string, arr);
  }

  const rows: ExportRow[] = [];

  for (const booking of bookings) {
    if (!booking.contact_id) continue;
    const contactLeads = leadsByContact.get(booking.contact_id as string) ?? [];

    // Most recent lead at or before booking.created_at. That's the lead
    // that converted into this booking — most defensible attribution.
    const bookingTime = new Date(booking.created_at as string).getTime();
    const matchingLead = contactLeads.find((l) => {
      const t = new Date(l.created_at as string).getTime();
      return t <= bookingTime;
    });

    const value = (booking.price_estimate as number | null) ?? 0;
    if (value <= 0) continue; // skip $0 conversions — Google Ads rejects them

    const email = emailByContact.get(booking.contact_id as string) ?? null;
    const emailHash = email ? await sha256Hex(email) : null;

    const shopSlug = slugByShopId.get(booking.shop_id as string);

    rows.push({
      booking_id: booking.id as string,
      shop_slug: shopSlug ?? "unknown",
      // Conversion action name in Google Ads. Must match exactly what's
      // configured in each shop's Google Ads account. Same name across
      // shops — they're routed by which tab/sheet the row lands in, not
      // by conversion action name.
      conversion_action: "Booking value (CRM offline)",
      conversion_time: booking.created_at as string,
      value,
      currency: "NZD",
      // Direct booking gclid (set when the customer booked directly without
      // a preceding lead form) takes priority. Fall back to the originating
      // lead's gclid when the customer enquired before booking.
      gclid: (booking.gclid as string | null) ?? matchingLead?.gclid ?? null,
      gbraid: (booking.gbraid as string | null) ?? matchingLead?.gbraid ?? null,
      wbraid: (booking.wbraid as string | null) ?? matchingLead?.wbraid ?? null,
      email_sha256: emailHash,
    });
  }

  return rows;
}

/**
 * Per-shop webhook URLs. Each shop has its own Google Ads account, so each
 * gets its own Sheet + Apps Script + scheduled Google Ads import.
 *
 * GOOGLE_ADS_SHEETS_WEBHOOK_URL is the historical (Christchurch) URL and
 * is kept as the default fallback so existing infra keeps working without
 * any rename. Add new shops as new env vars below.
 */
const WEBHOOK_URL_BY_SHOP: Record<string, string | undefined> = {
  christchurch: process.env.GOOGLE_ADS_SHEETS_WEBHOOK_URL,
  wellington: process.env.GOOGLE_ADS_SHEETS_WEBHOOK_URL_WELLINGTON,
};

async function postRowsToShop(args: {
  shopSlug: string;
  url: string;
  rows: ExportRow[];
  secret: string | undefined;
}) {
  // Apps Script POSTs respond with a 302 to a googleusercontent.com URL whose
  // GET serves the doPost return value. Default fetch redirect following
  // handles this correctly — the doPost has already run by the time we
  // follow the redirect. Don't try to re-POST the redirect target; 405.
  //
  // Secret goes in the body — Apps Script can't read custom HTTP headers.
  const response = await fetch(args.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: args.rows, secret: args.secret }),
  });

  const responseText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`[${args.shopSlug}] Sheets webhook HTTP ${response.status}: ${responseText.slice(0, 300)}`);
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`[${args.shopSlug}] Sheets webhook returned non-JSON: ${responseText.slice(0, 300)}`);
  }
  if (parsed.ok !== true) {
    throw new Error(`[${args.shopSlug}] Sheets webhook rejected: ${parsed.error ?? JSON.stringify(parsed).slice(0, 300)}`);
  }
  return parsed;
}

/**
 * Run the export for the previous 24h window. Called by the daily cron.
 *
 * Rows are grouped by shop_slug and POSTed to each shop's own Apps Script
 * webhook. Per-shop URLs are required because each shop runs its own
 * Google Ads account, importing from its own Sheet on its own schedule.
 *
 * Failure of one shop's webhook does NOT block the other — the function
 * collects per-shop results and surfaces them in the response, so a
 * misconfigured Wellington URL can't silently drop Christchurch rows
 * (or vice versa).
 */
export async function exportRecentBookingsForGoogleAds() {
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = addDays(now, -1).toISOString();

  const rows = await buildExportRows({
    windowStartIso: windowStart,
    windowEndIso: windowEnd,
  });

  if (rows.length === 0) {
    return { exported: 0, withAttribution: 0, byShop: {} };
  }

  // Group rows by shop
  const rowsByShop = new Map<string, ExportRow[]>();
  for (const row of rows) {
    const arr = rowsByShop.get(row.shop_slug) ?? [];
    arr.push(row);
    rowsByShop.set(row.shop_slug, arr);
  }

  const secret = process.env.GOOGLE_ADS_SHEETS_WEBHOOK_SECRET;
  const byShop: Record<string, unknown> = {};
  const errors: string[] = [];
  let totalExported = 0;
  let totalWithAttribution = 0;

  for (const [shopSlug, shopRows] of rowsByShop) {
    const url = WEBHOOK_URL_BY_SHOP[shopSlug];
    const withAttribution = shopRows.filter(
      (r) => r.gclid || r.gbraid || r.wbraid || r.email_sha256
    ).length;

    if (!url) {
      // No webhook configured for this shop. Surface it so it's visible in
      // the cron response and gets fixed, instead of silently dropping rows.
      byShop[shopSlug] = {
        skipped: true,
        reason: `No webhook URL configured for shop ${shopSlug}`,
        rows: shopRows.length,
        withAttribution,
      };
      errors.push(`No webhook for ${shopSlug} (${shopRows.length} rows dropped)`);
      continue;
    }

    try {
      const sheetsResponse = await postRowsToShop({ shopSlug, url, rows: shopRows, secret });
      byShop[shopSlug] = {
        exported: shopRows.length,
        withAttribution,
        sheetsResponse,
      };
      totalExported += shopRows.length;
      totalWithAttribution += withAttribution;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      byShop[shopSlug] = {
        error: message,
        rows: shopRows.length,
        withAttribution,
      };
      errors.push(message);
    }
  }

  if (errors.length > 0 && totalExported === 0) {
    // Every shop failed — let the cron route return 500 so it shows up as
    // a failed invocation in Vercel. If at least one shop succeeded, we
    // return 200 with the per-shop breakdown so partial success is visible
    // but the cron stays green.
    throw new Error(errors.join("; "));
  }

  return { exported: totalExported, withAttribution: totalWithAttribution, byShop };
}
