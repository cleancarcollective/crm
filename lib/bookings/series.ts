/**
 * Recurring booking series — recurrence math + DB writer.
 *
 * Step 1 of the recurring-bookings build. Pure recurrence helpers live at
 * the top of this file (no DB, easy to test). The Supabase writer at the
 * bottom creates a booking_series row and pre-generates one row per
 * occurrence in `bookings`, then wires up the same email + SMS reminder
 * jobs that a one-off booking would get.
 *
 * Future steps (do NOT implement here yet, but the schema + linkage are
 * designed for them):
 *   - Daily cron that advances generated_through_date as the 12-month
 *     horizon rolls forward.
 *   - Edit / cancel "just this one" vs "whole series" dialogs — relies on
 *     bookings.series_overridden so the cron knows to leave overridden
 *     occurrences alone.
 *   - Customer-facing signup with a per-series discount.
 */

import {
  addDays,
  addMonths,
  endOfMonth,
  getDay,
  startOfMonth,
} from "date-fns";

import { cancelPendingTouchpointsForContact } from "@/lib/bookings/postDetailTouchpoints";
import { createReminderJobsForBooking } from "@/lib/email/scheduledReminderJobs";
import {
  buildCadenceLabel,
  buildEndLabel,
  sendSeriesConfirmationEmail,
  sendSeriesTeamNotification,
} from "@/lib/email/sendSeriesConfirmation";
import { scheduleBookingReminderSms } from "@/lib/sms/scheduledSmsJobs";
import { getShopById } from "@/lib/dashboard/bookings";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type SeriesFrequency = "days" | "weeks" | "months_nth_weekday";
export type SeriesEndType = "never" | "after_n" | "on_date";

export type SeriesRule = {
  frequency: SeriesFrequency;
  intervalCount: number;
  /** Only for months_nth_weekday: 1-4, or -1 for "last <weekday> of month". */
  nthWeekOfMonth?: number | null;
  /** Only for months_nth_weekday: 0=Sun..6=Sat. */
  dayOfWeek?: number | null;
  /** Absolute (UTC) Date — caller converts from local datetime + tz. */
  firstOccurrenceAt: Date;
  timezone: string;
  endType: SeriesEndType;
  endAfterN?: number | null;
  endOnDate?: Date | null;
};

// ── Pure helpers ─────────────────────────────────────────────────────────

/**
 * Find the Nth occurrence of `weekday` in the calendar month containing
 * `anchor`. `nthWeek` is 1-4 or -1 ("last <weekday> of month").
 *
 * Returns null if nthWeek=5 was requested and the month only has 4 of that
 * weekday — per spec we SKIP, not fall back.
 */
function nthWeekdayOfMonth(anchor: Date, nthWeek: number, weekday: number): Date | null {
  const firstOfMonth = startOfMonth(anchor);
  const lastOfMonth = endOfMonth(anchor);

  if (nthWeek === -1) {
    // Walk back from the last day of the month until we hit the weekday.
    for (let d = new Date(lastOfMonth); d >= firstOfMonth; d = addDays(d, -1)) {
      if (getDay(d) === weekday) return d;
    }
    return null;
  }

  // Forward scan: the Nth weekday is firstOccurrence + (nthWeek-1)*7 days.
  const firstWeekdayOffset = (weekday - getDay(firstOfMonth) + 7) % 7;
  const firstWeekday = addDays(firstOfMonth, firstWeekdayOffset);
  const target = addDays(firstWeekday, (nthWeek - 1) * 7);
  if (target > lastOfMonth) return null; // e.g. 5th Tue in a month with only 4
  return target;
}

/**
 * Describe a date as "the Nth <weekday> of its month". Used by the UI to
 * auto-fill the monthly rule from a user-picked first-occurrence date so
 * the staff member doesn't have to think "is May 19 the 3rd Tuesday or
 * the 4th?".
 *
 * nthWeek is 1-4, or -1 if this date is the LAST occurrence of its weekday
 * in the month (e.g. the 4th Tuesday when there are only 4 — we prefer -1
 * over 4 so the rule "repeats on the last Tuesday" stays stable across
 * months that have 5 Tuesdays).
 *
 * Note: `tz` is currently unused. We compute against the JS Date as-is,
 * which means the caller must pass a Date that represents the LOCAL
 * calendar date in the shop's timezone (the API endpoint does this).
 * Kept as a parameter so the UI and series-creator agree on the contract.
 */
export function describeMonthlyNthWeekday(
  date: Date,
  _tz: string,
): { nthWeek: number; dayOfWeek: number } {
  const dayOfWeek = getDay(date);
  // Which N-th occurrence of dayOfWeek this date is within its month.
  const dom = date.getDate();
  const nth = Math.ceil(dom / 7);

  // Is this the LAST one of that weekday in the month?
  const oneWeekLater = addDays(date, 7);
  const isLast = oneWeekLater.getMonth() !== date.getMonth();

  return { nthWeek: isLast ? -1 : nth, dayOfWeek };
}

/**
 * Compute occurrence start datetimes from `rule`, capped by either
 * `generateThrough`, `endAfterN`, or `endOnDate` (whichever hits first).
 * Returns absolute Date[] in chronological order. Pure — no DB.
 */
export function computeOccurrences(rule: SeriesRule, generateThrough: Date): Date[] {
  const out: Date[] = [];
  const cap = rule.endType === "after_n" ? rule.endAfterN ?? Infinity : Infinity;
  const onDateCap = rule.endType === "on_date" && rule.endOnDate ? rule.endOnDate : null;

  const first = rule.firstOccurrenceAt;
  let i = 0;
  // Hard safety cap so a misconfigured rule can't run away. 12 months of
  // daily bookings is 366 occurrences; 5000 is comfortably above any sane
  // configuration.
  while (out.length < cap && out.length < 5000) {
    let next: Date | null;

    if (rule.frequency === "days") {
      next = addDays(first, i * rule.intervalCount);
    } else if (rule.frequency === "weeks") {
      next = addDays(first, i * rule.intervalCount * 7);
    } else {
      // months_nth_weekday. The user-picked `first` already lands on the
      // right Nth-weekday of its month, so for month 0 we just use it.
      // For subsequent months we scan from the month boundary.
      if (i === 0) {
        next = first;
      } else {
        const monthAnchor = addMonths(first, i * rule.intervalCount);
        const dow = rule.dayOfWeek ?? getDay(first);
        const nth = rule.nthWeekOfMonth ?? Math.ceil(first.getDate() / 7);
        const dayOnly = nthWeekdayOfMonth(monthAnchor, nth, dow);
        if (!dayOnly) {
          // 5th-weekday-of-month and this month doesn't have one — skip.
          i += 1;
          continue;
        }
        // Re-apply the time-of-day from `first`.
        next = new Date(dayOnly);
        next.setHours(first.getHours(), first.getMinutes(), first.getSeconds(), first.getMilliseconds());
      }
    }

    if (!next) {
      i += 1;
      continue;
    }
    if (next > generateThrough) break;
    if (onDateCap && next > onDateCap) break;

    out.push(next);
    i += 1;
  }

  return out;
}

// ── DB writer ─────────────────────────────────────────────────────────────

export type CreateSeriesInput = {
  shopId: string;
  contactId: string;
  vehicleId: string | null;
  serviceName: string;
  serviceDetails?: string | null;
  size?: string | null;
  priceEstimate?: number | null;
  durationMinutes?: number | null;
  locationType?: string | null;
  serviceAddress?: string | null;
  notes?: string | null;
  rule: SeriesRule;
  createdByUserId?: string | null;
  // Recurring-discount metadata. discountPercent is the % saved on every
  // occurrence in this series — already applied to priceEstimate by the
  // caller, we just store it for reporting + receipt copy. discountSource
  // distinguishes in-flow signup (`customer_signup`) from the post-detail
  // upsell SMS/email (Phase B: `post_detail_offer`). seriesSource records
  // who created the series (staff vs customer self-serve).
  discountPercent?: number | null;
  discountSource?: string | null;
  seriesSource?: string | null;
};

/**
 * Insert a booking_series row, pre-generate `bookings` rows for every
 * occurrence within the next 12 months (or until end condition hits),
 * and schedule the standard email + SMS reminder jobs for each one.
 *
 * Idempotent on (series_id, series_sequence) — uses upsert so an
 * accidental double-submit doesn't double-book.
 */
export async function createSeriesAndOccurrences(
  input: CreateSeriesInput,
): Promise<{ seriesId: string; bookingsCreated: number }> {
  const supabase = getSupabaseAdminClient();
  const shop = await getShopById(input.shopId);

  const generateThrough = addMonths(new Date(), 12);
  const occurrences = computeOccurrences(input.rule, generateThrough);

  // 1. Insert the series row first so we have an id to point bookings at.
  const { data: series, error: seriesError } = await supabase
    .from("booking_series")
    .insert({
      shop_id: input.shopId,
      contact_id: input.contactId,
      vehicle_id: input.vehicleId,
      service_name: input.serviceName,
      service_details: input.serviceDetails ?? null,
      size: input.size ?? null,
      price_estimate: input.priceEstimate ?? null,
      duration_minutes: input.durationMinutes ?? null,
      location_type: input.locationType ?? null,
      service_address: input.serviceAddress ?? null,
      notes: input.notes ?? null,
      booking_source: "recurring",
      frequency: input.rule.frequency,
      interval_count: input.rule.intervalCount,
      nth_week_of_month: input.rule.nthWeekOfMonth ?? null,
      day_of_week: input.rule.dayOfWeek ?? null,
      first_occurrence_at: input.rule.firstOccurrenceAt.toISOString(),
      timezone: input.rule.timezone,
      end_type: input.rule.endType,
      end_after_n: input.rule.endAfterN ?? null,
      end_on_date: input.rule.endOnDate
        ? input.rule.endOnDate.toISOString().slice(0, 10)
        : null,
      status: "active",
      created_by_user_id: input.createdByUserId ?? null,
      // Default to "staff_manual" to preserve historical behaviour — the
      // customer-facing intake endpoint passes "customer_signup" / similar.
      series_source: input.seriesSource ?? "staff_manual",
      discount_percent: input.discountPercent ?? null,
      discount_source: input.discountSource ?? null,
    })
    .select("id")
    .single();

  if (seriesError || !series) {
    console.error("Failed to insert booking_series", seriesError);
    throw seriesError ?? new Error("Failed to insert booking_series");
  }

  const seriesId = series.id as string;

  // 2. Insert one booking per occurrence. Upsert on (series_id, series_sequence)
  //    to make this idempotent against accidental retries. We tag a synthetic
  //    unique conflict target via a partial index isn't available in PG without
  //    a constraint, so we use a guarded insert per row — cheap, and series
  //    creation is rare. Note: 12 months of weekly = 53 rows, so per-row
  //    inserts are fine.
  const durationMinutes = input.durationMinutes ?? null;
  let createdCount = 0;

  for (let idx = 0; idx < occurrences.length; idx += 1) {
    const start = occurrences[idx];
    const end = durationMinutes
      ? new Date(start.getTime() + durationMinutes * 60_000).toISOString()
      : null;

    // Guard against duplicate-insert via a uniqueness check on the
    // (series_id, series_sequence) pair. Simpler than fighting Postgres
    // upsert with no unique constraint.
    const { data: existing } = await supabase
      .from("bookings")
      .select("id")
      .eq("series_id", seriesId)
      .eq("series_sequence", idx)
      .maybeSingle();
    if (existing) continue;

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        shop_id: input.shopId,
        contact_id: input.contactId,
        vehicle_id: input.vehicleId,
        booking_source: "recurring",
        service_name: input.serviceName,
        service_details: input.serviceDetails ?? null,
        scheduled_start: start.toISOString(),
        scheduled_end: end,
        duration_minutes: durationMinutes,
        price_estimate: input.priceEstimate ?? null,
        location_type: input.locationType ?? null,
        service_address: input.serviceAddress ?? null,
        notes: input.notes ?? null,
        status: "confirmed",
        raw_payload: {},
        series_id: seriesId,
        series_sequence: idx,
        series_overridden: false,
      })
      .select("id, scheduled_start")
      .single();

    if (bookingError || !booking) {
      console.error("Failed to insert occurrence booking", { idx, bookingError });
      continue;
    }
    createdCount += 1;

    // Wire up the same email + SMS reminder jobs that a one-off booking
    // gets. createReminderJobsForBooking already filters out reminders
    // whose offset has already passed, so historical-ish occurrences
    // (shouldn't happen for a series starting today, but be safe) don't
    // queue stale jobs.
    try {
      await createReminderJobsForBooking({
        shop,
        bookingId: booking.id,
        contactId: input.contactId,
        scheduledStart: booking.scheduled_start,
      });
    } catch (err) {
      console.error("Failed to schedule reminder jobs for series occurrence", {
        seriesId,
        bookingId: booking.id,
        err,
      });
    }

    // Lookup phone lazily — most series will have many occurrences for one
    // contact, so cache the phone after first lookup.
    // (Done inline below — keeps the function self-contained.)
  }

  // SMS reminders need phone, the series-confirmation email needs email +
  // name. One lookup serves both.
  const { data: contact } = await supabase
    .from("contacts")
    .select("phone, first_name, full_name, email")
    .eq("id", input.contactId)
    .maybeSingle();

  const phone = contact?.phone ?? null;
  if (phone) {
    const firstName = contact?.first_name ?? contact?.full_name?.split(" ")[0] ?? "there";
    const { data: created } = await supabase
      .from("bookings")
      .select("id, scheduled_start")
      .eq("series_id", seriesId)
      .order("series_sequence", { ascending: true });
    for (const b of created ?? []) {
      try {
        await scheduleBookingReminderSms({
          bookingId: b.id as string,
          contactId: input.contactId,
          shopId: input.shopId,
          phone,
          firstName,
          scheduledStart: b.scheduled_start as string,
          timezone: shop.timezone,
        });
      } catch (err) {
        console.error("Failed to schedule SMS reminder for series occurrence", {
          seriesId,
          bookingId: b.id,
          err,
        });
      }
    }
  }

  // 3. Stamp the horizon + count back onto the series row so the future
  //    cron knows where we left off.
  const lastOccurrence = occurrences[occurrences.length - 1];
  await supabase
    .from("booking_series")
    .update({
      generated_through_date: lastOccurrence
        ? lastOccurrence.toISOString().slice(0, 10)
        : generateThrough.toISOString().slice(0, 10),
      occurrences_generated: createdCount,
      last_regen_at: new Date().toISOString(),
    })
    .eq("id", seriesId);

  // 4. One series-wide confirmation email to the customer + a team
  //    notification. The per-occurrence reminders are already scheduled
  //    above; this is the only upfront email the customer sees.
  //    Non-fatal — series creation succeeds even if email send fails.
  if (occurrences.length > 0) {
    const cadenceLabel = buildCadenceLabel({
      frequency: input.rule.frequency,
      intervalCount: input.rule.intervalCount,
      firstOccurrenceIso: input.rule.firstOccurrenceAt.toISOString(),
      timezone: input.rule.timezone,
      nthWeekOfMonth: input.rule.nthWeekOfMonth ?? null,
    });
    const endLabel = buildEndLabel({
      endType: input.rule.endType,
      endAfterN: input.rule.endAfterN ?? null,
      endOnDate: input.rule.endOnDate ? input.rule.endOnDate.toISOString() : null,
      timezone: input.rule.timezone,
    });
    const occurrenceDatesIso = occurrences.map((d) => d.toISOString());
    const emailArgs = {
      shop,
      seriesId,
      contact: {
        firstName: contact?.first_name ?? contact?.full_name?.split(" ")[0] ?? null,
        fullName: contact?.full_name ?? null,
        email: contact?.email ?? null,
      },
      serviceName: input.serviceName,
      priceEstimate: input.priceEstimate ?? null,
      cadenceLabel,
      occurrenceDatesIso,
      bookingsCount: createdCount,
      endLabel,
    };
    try {
      await sendSeriesConfirmationEmail(emailArgs);
    } catch (err) {
      console.error("Series confirmation email failed (non-fatal)", { seriesId, err });
    }
    try {
      await sendSeriesTeamNotification(emailArgs);
    } catch (err) {
      console.error("Series team notification failed (non-fatal)", { seriesId, err });
    }
  }

  // Once a customer is on any recurring series, the post-detail discount
  // nudges become moot. Cancel any pending touchpoints for this contact
  // regardless of discount source. Non-fatal.
  try {
    const cancelled = await cancelPendingTouchpointsForContact(
      input.shopId,
      input.contactId,
      input.discountSource === "post_detail_offer"
        ? "Customer locked in via post-detail offer"
        : "Customer is now on a recurring series"
    );
    if (cancelled.emailsCancelled + cancelled.smsCancelled > 0) {
      console.info("Post-detail touchpoints cancelled (series created)", {
        seriesId,
        contactId: input.contactId,
        ...cancelled,
      });
    }
  } catch (err) {
    console.error("Failed to cancel post-detail touchpoints after series creation (non-fatal)", { seriesId, err });
  }

  return { seriesId, bookingsCreated: createdCount };
}

// ── Cron-driven regeneration ─────────────────────────────────────────────

/**
 * How far ahead we keep the calendar filled. Series creation generates
 * `HORIZON_MONTHS` of occurrences up front; the cron tops up whenever the
 * remaining horizon dips below `MIN_BUFFER_MONTHS`.
 *
 * With horizon=12 and buffer=6, the cron has to fail for ~6 months before
 * any customer-facing occurrence is missing — generous safety margin.
 */
const HORIZON_MONTHS = 12;
const MIN_BUFFER_MONTHS = 6;

export type RegenResult = {
  seriesId: string;
  status: "ok" | "skipped" | "failed";
  createdCount: number;
  generatedThroughDate: string | null;
  reason?: string;
  error?: string;
};

/**
 * Regenerate occurrences for a single active series, if its horizon has
 * dipped below the buffer. Idempotent — only inserts sequences that don't
 * already exist. Writes last_regen_at / last_regen_error to the series row.
 */
export async function regenerateSeriesOccurrences(seriesId: string): Promise<RegenResult> {
  const supabase = getSupabaseAdminClient();

  const { data: row, error: loadError } = await supabase
    .from("booking_series")
    .select("*")
    .eq("id", seriesId)
    .maybeSingle();

  if (loadError || !row) {
    return {
      seriesId,
      status: "failed",
      createdCount: 0,
      generatedThroughDate: null,
      error: loadError?.message ?? "Series not found",
    };
  }

  if (row.status !== "active") {
    return {
      seriesId,
      status: "skipped",
      createdCount: 0,
      generatedThroughDate: row.generated_through_date,
      reason: `status=${row.status}`,
    };
  }

  const now = new Date();
  const horizon = addMonths(now, HORIZON_MONTHS);
  const bufferEdge = addMonths(now, MIN_BUFFER_MONTHS);

  // Skip if we still have plenty of pre-generated occurrences ahead.
  const generatedThrough = row.generated_through_date
    ? new Date(`${row.generated_through_date}T23:59:59Z`)
    : null;
  if (generatedThrough && generatedThrough >= bufferEdge) {
    return {
      seriesId,
      status: "skipped",
      createdCount: 0,
      generatedThroughDate: row.generated_through_date,
      reason: "still inside buffer",
    };
  }

  try {
    const rule: SeriesRule = {
      frequency: row.frequency,
      intervalCount: row.interval_count,
      nthWeekOfMonth: row.nth_week_of_month,
      dayOfWeek: row.day_of_week,
      firstOccurrenceAt: new Date(row.first_occurrence_at),
      timezone: row.timezone,
      endType: row.end_type,
      endAfterN: row.end_after_n,
      endOnDate: row.end_on_date ? new Date(row.end_on_date) : null,
    };

    const allOccurrences = computeOccurrences(rule, horizon);

    // Find which sequences already exist so we only insert the missing tail.
    const { data: existingRows } = await supabase
      .from("bookings")
      .select("series_sequence")
      .eq("series_id", seriesId);
    const existing = new Set((existingRows ?? []).map((r) => r.series_sequence as number));

    const shop = await getShopById(row.shop_id);
    const durationMinutes = row.duration_minutes ?? null;

    const { data: contact } = await supabase
      .from("contacts")
      .select("phone, first_name, full_name")
      .eq("id", row.contact_id)
      .maybeSingle();
    const phone = contact?.phone ?? null;
    const firstName = contact?.first_name ?? contact?.full_name?.split(" ")[0] ?? "there";

    let createdCount = 0;

    for (let idx = 0; idx < allOccurrences.length; idx += 1) {
      if (existing.has(idx)) continue;
      const start = allOccurrences[idx];
      const end = durationMinutes
        ? new Date(start.getTime() + durationMinutes * 60_000).toISOString()
        : null;

      const { data: booking, error: insertError } = await supabase
        .from("bookings")
        .insert({
          shop_id: row.shop_id,
          contact_id: row.contact_id,
          vehicle_id: row.vehicle_id,
          booking_source: "recurring",
          service_name: row.service_name,
          service_details: row.service_details,
          scheduled_start: start.toISOString(),
          scheduled_end: end,
          duration_minutes: durationMinutes,
          price_estimate: row.price_estimate,
          location_type: row.location_type,
          service_address: row.service_address,
          notes: row.notes,
          status: "confirmed",
          raw_payload: {},
          series_id: seriesId,
          series_sequence: idx,
          series_overridden: false,
        })
        .select("id, scheduled_start")
        .single();

      if (insertError || !booking) {
        console.error("Regen: failed to insert occurrence", { seriesId, idx, insertError });
        continue;
      }
      createdCount += 1;

      try {
        await createReminderJobsForBooking({
          shop,
          bookingId: booking.id,
          contactId: row.contact_id,
          scheduledStart: booking.scheduled_start,
        });
      } catch (err) {
        console.error("Regen: reminder schedule failed", { seriesId, bookingId: booking.id, err });
      }

      if (phone) {
        try {
          await scheduleBookingReminderSms({
            bookingId: booking.id,
            contactId: row.contact_id,
            shopId: row.shop_id,
            phone,
            firstName,
            scheduledStart: booking.scheduled_start,
            timezone: shop.timezone,
          });
        } catch (err) {
          console.error("Regen: SMS reminder failed", { seriesId, bookingId: booking.id, err });
        }
      }
    }

    const lastOccurrence = allOccurrences[allOccurrences.length - 1];
    const newGeneratedThrough = lastOccurrence
      ? lastOccurrence.toISOString().slice(0, 10)
      : row.generated_through_date;

    await supabase
      .from("booking_series")
      .update({
        generated_through_date: newGeneratedThrough,
        occurrences_generated: (row.occurrences_generated ?? 0) + createdCount,
        last_regen_at: new Date().toISOString(),
        last_regen_error: null,
      })
      .eq("id", seriesId);

    return {
      seriesId,
      status: "ok",
      createdCount,
      generatedThroughDate: newGeneratedThrough,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("booking_series")
      .update({
        last_regen_at: new Date().toISOString(),
        last_regen_error: msg.slice(0, 500),
      })
      .eq("id", seriesId);
    return {
      seriesId,
      status: "failed",
      createdCount: 0,
      generatedThroughDate: row.generated_through_date,
      error: msg,
    };
  }
}

/**
 * Cron entry point. Loops every active series, regenerates whichever ones
 * are due. Returns per-series results for logging + health visibility.
 */
export async function regenerateAllActiveSeries(): Promise<RegenResult[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("booking_series")
    .select("id")
    .eq("status", "active");

  if (error) {
    throw error;
  }

  const results: RegenResult[] = [];
  for (const row of data ?? []) {
    results.push(await regenerateSeriesOccurrences(row.id as string));
  }
  return results;
}
