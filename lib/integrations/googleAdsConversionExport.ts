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
  // Apps Script dispatches by row_type: 'booking' → Bookings tab,
  // 'form' → Forms tab. Each tab is connected to a different Google Ads
  // conversion action via Data Manager.
  row_type: "booking" | "form";
  // booking_id for row_type='booking', lead_id for row_type='form'.
  // The Apps Script writes this into the "Booking ID" / "Lead ID" column
  // and uses it as the dedupe key.
  record_id: string;
  // Kept for backwards compatibility with existing Apps Script versions
  // that still read booking_id from the row. Both fields are set to the
  // same value for booking rows; for form rows, booking_id is null.
  booking_id: string | null;
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
  // Email for Enhanced Conversions for Leads (the match key when there's no
  // gclid). NOTE: this carries the RAW (lowercased/trimmed) email, NOT a
  // hash — the Google Sheets offline-import column is mapped as plain
  // "Email", so Google hashes it server-side. Pre-hashing here caused a
  // double-hash and zero user-data matches ("No user-provided data matches"
  // diagnostic). The field key stays `email_sha256` for backwards-compat
  // with the bound Apps Script, which maps this key → the sheet's "Email"
  // column. (Sheet is access-controlled and already holds booking PII.)
  email_sha256: string | null;
};

/**
 * Per-form value for Smart Bidding. Calculated as average order value
 * ($310) × form→booking conversion rate (20%). Adjust here if either
 * input drifts.
 */
const FORM_VALUE_NZD = 62;

/**
 * Normalise an email the way Google expects before it hashes it server-side:
 * trim whitespace + lowercase. We deliberately DO NOT hash — the Sheets
 * import column is plain "Email", so Google does the hashing. Pre-hashing
 * caused a double-hash → zero Enhanced-Conversions matches.
 */
function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Format a timestamp the way Google Ads Data Manager requires for the
 * Conversion Time column: "yyyy-MM-dd HH:mm:ss±HH:mm" — a SPACE separator
 * and NO fractional seconds.
 *
 * Postgres timestamptz serialises to ISO 8601 with microseconds and a "T",
 * e.g. "2026-05-18T06:56:26.417416+00:00". The legacy Sheets importer
 * tolerated that, but the newer Data Manager importer rejects it with
 * "Make sure that this column contains a valid timestamp" — silently
 * failing EVERY row (0 imported). This converts it to the accepted form:
 * "2026-05-18 06:56:26+00:00".
 */
function formatAdsConversionTime(iso: string): string {
  return iso
    .replace("T", " ")        // T separator → space
    .replace(/\.\d+/, "")      // strip fractional seconds
    .replace(/Z$/, "+00:00");  // normalise a trailing Z to an explicit offset
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
      gclid, gbraid, wbraid, series_id, series_sequence
    `)
    .neq("status", "cancelled")
    .gte("created_at", args.windowStartIso)
    .lt("created_at", args.windowEndIso);

  if (bookingsErr) throw bookingsErr;
  if (!bookings || bookings.length === 0) return [];

  // Recurring-series dedupe. When a customer signs up for a recurring
  // detail (e.g. quarterly), the CRM creates one booking row per future
  // appointment in the series, all with the same series_id and identical
  // price_estimate, all `created_at` within the same second. Each one
  // landed in Ads as a separate conversion — Smart Bidding then thought
  // a single click produced N× the actual revenue.
  //
  // Fix: only the first booking in each series (series_sequence=0) gets
  // exported. Subsequent appointments in the same series are skipped.
  // Non-recurring bookings (series_id IS NULL) are unaffected.
  const bookingsDedupedBySeries = bookings.filter((b) => {
    const seriesId = b.series_id as string | null;
    if (!seriesId) return true;
    const seq = b.series_sequence as number | null;
    return seq === 0 || seq === null;
  });

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
    new Set(bookingsDedupedBySeries.map((b) => b.contact_id).filter((v): v is string => Boolean(v)))
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

  for (const booking of bookingsDedupedBySeries) {
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
    const emailNormalized = email ? normalizeEmail(email) : null;

    const gclid = (booking.gclid as string | null) ?? matchingLead?.gclid ?? null;
    const gbraid = (booking.gbraid as string | null) ?? matchingLead?.gbraid ?? null;
    const wbraid = (booking.wbraid as string | null) ?? matchingLead?.wbraid ?? null;

    // Skip rows with no attribution signal at all. Without a click ID OR
    // a hashed email, Ads has nothing to match against — the row would be
    // silently rejected. Log it so the gap is visible, and skip the upload.
    if (!gclid && !gbraid && !wbraid && !emailNormalized) {
      console.warn("[ads-export] booking has no attribution signal — skipping", {
        booking_id: booking.id,
        shop_id: booking.shop_id,
        value,
      });
      continue;
    }

    const shopSlug = slugByShopId.get(booking.shop_id as string);

    rows.push({
      row_type: "booking",
      record_id: booking.id as string,
      booking_id: booking.id as string,
      shop_slug: shopSlug ?? "unknown",
      // Conversion action name in Google Ads. Must match exactly what's
      // configured in each shop's Google Ads account. Same name across
      // shops — they're routed by which tab/sheet the row lands in, not
      // by conversion action name.
      conversion_action: "Booking value (CRM offline)",
      conversion_time: formatAdsConversionTime(booking.created_at as string),
      value,
      currency: "NZD",
      // Direct booking gclid (set when the customer booked directly without
      // a preceding lead form) takes priority. Fall back to the originating
      // lead's gclid when the customer enquired before booking.
      gclid,
      gbraid,
      wbraid,
      email_sha256: emailNormalized,
    });
  }

  return rows;
}

/**
 * Pull lead form submissions created in [windowStart, windowEnd) that have
 * a Google Click ID attached, and turn them into form-conversion rows.
 *
 * Each row goes to the "Forms" tab of the shop's Google Sheet → Google Ads
 * "Estimate form (CRM offline)" conversion (Secondary). This signal lets
 * Smart Bidding see real form-submission counts (the page-load pixel
 * undercounts by 30-60%) and gives form-stage attribution visibility in
 * the Ads UI on top of the booking-stage signal.
 *
 * Form value is fixed at FORM_VALUE_NZD (currently $62 = $310 AOV × 20%
 * form→booking conversion rate). Smart Bidding doesn't actually use this
 * because Estimate form is configured as Secondary, but value still
 * appears in "All conversion value" reports.
 *
 * Dedupe between form fill + later booking is left to Google Ads — its
 * attribution modelling handles per-click conversions across actions
 * without over-rewarding any single click.
 */
async function buildFormRows(args: {
  windowStartIso: string;
  windowEndIso: string;
}): Promise<ExportRow[]> {
  const supabase = getSupabaseAdminClient();

  // Previously this query filtered to leads with a GCLID. Google's Ads UI
  // started flagging "Importing limited user-provided data" — they want
  // every event we have user data for, not just the click-attributed
  // ones. Enhanced Conversions for Leads matches on hashed email alone
  // (no GCLID needed), so dropping the filter ~doubles upload volume
  // without sacrificing match quality. Rows with neither a click ID nor
  // a hashed email are filtered below before they hit the sheet.
  const { data: leads, error: leadsErr } = await supabase
    .from("leads")
    .select(`
      id, shop_id, contact_id, created_at,
      gclid, gbraid, wbraid
    `)
    .gte("created_at", args.windowStartIso)
    .lt("created_at", args.windowEndIso);

  if (leadsErr) throw leadsErr;
  if (!leads || leads.length === 0) return [];

  // Shop slug lookup (same explicit-join pattern as buildExportRows;
  // PostgREST embedded joins occasionally return null for valid shop_id
  // rows).
  const { data: shops } = await supabase.from("shops").select("id, slug");
  const slugByShopId = new Map<string, string>();
  for (const s of shops ?? []) {
    if (s.id && s.slug) slugByShopId.set(s.id as string, s.slug as string);
  }

  // Email for Enhanced Conversions for Leads fallback.
  const contactIds = Array.from(
    new Set(leads.map((l) => l.contact_id).filter((v): v is string => Boolean(v)))
  );
  const emailByContact = new Map<string, string | null>();
  if (contactIds.length > 0) {
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, email")
      .in("id", contactIds);
    for (const c of contacts ?? []) {
      emailByContact.set(c.id as string, (c.email as string | null) ?? null);
    }
  }

  const rows: ExportRow[] = [];
  for (const lead of leads) {
    const email = lead.contact_id ? emailByContact.get(lead.contact_id as string) ?? null : null;
    const emailNormalized = email ? normalizeEmail(email) : null;
    const gclid = lead.gclid as string | null;
    const gbraid = lead.gbraid as string | null;
    const wbraid = lead.wbraid as string | null;

    // Require at least one attribution signal — click ID OR hashed email.
    // Without either, Ads has no way to attribute the conversion to a
    // user or click; the row would silently bounce.
    if (!gclid && !gbraid && !wbraid && !emailNormalized) {
      console.warn("[ads-export] lead has no attribution signal — skipping", {
        lead_id: lead.id,
        shop_id: lead.shop_id,
      });
      continue;
    }

    const shopSlug = slugByShopId.get(lead.shop_id as string);

    rows.push({
      row_type: "form",
      record_id: lead.id as string,
      booking_id: null,
      shop_slug: shopSlug ?? "unknown",
      conversion_action: "Estimate form (CRM offline)",
      conversion_time: formatAdsConversionTime(lead.created_at as string),
      value: FORM_VALUE_NZD,
      currency: "NZD",
      gclid,
      gbraid,
      wbraid,
      email_sha256: emailNormalized,
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
export async function exportRecentBookingsForGoogleAds(opts: { windowDays?: number } = {}) {
  const windowDays = opts.windowDays ?? 1;
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = addDays(now, -windowDays).toISOString();

  const [bookingRows, formRows] = await Promise.all([
    buildExportRows({ windowStartIso: windowStart, windowEndIso: windowEnd }),
    buildFormRows({ windowStartIso: windowStart, windowEndIso: windowEnd }),
  ]);
  const rows = [...bookingRows, ...formRows];

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
        bookings: shopRows.filter((r) => r.row_type === "booking").length,
        forms: shopRows.filter((r) => r.row_type === "form").length,
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
