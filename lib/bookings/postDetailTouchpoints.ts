/**
 * Phase B — Post-detail recurring-discount touchpoints.
 *
 * When a booking flips to status='completed' we schedule 4 follow-up
 * email+SMS pairs that walk the customer through tiered recurring
 * discount offers (15% / 15% / 10% / 5% over ~16 weeks).
 *
 * - Eligibility: package services only (Deluxe / Premium full / interior /
 *   exterior). Ceramic coatings and paint corrections are excluded.
 * - Skipped if the booking is already part of a recurring series (the
 *   customer is already on a recurring rate).
 * - Idempotent: unique constraint on (shop_id, booking_id, template_key)
 *   in scheduled_email_jobs and scheduled_sms_jobs prevents dupes if staff
 *   toggle status off and back on.
 *
 * The link in each touchpoint points at /lock-in-recurring?token=<signed>.
 * The page itself is Phase C and is not part of this module — only the
 * signed token is generated here. Token action='lock_in_recurring',
 * 30-day expiry.
 */

import { addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type TouchpointKey =
  | "post_detail_recurring_offer_next_day"
  | "post_detail_recurring_offer_6w"
  | "post_detail_recurring_offer_10w"
  | "post_detail_recurring_offer_16w";

export type TouchpointDef = {
  key: TouchpointKey;
  offsetDays: number;
  fireAtLocalHour: number;
  featuredCadenceMonths: 1 | 3 | 6;
  discountPercent: number;
};

export const POST_DETAIL_TOUCHPOINTS: TouchpointDef[] = [
  { key: "post_detail_recurring_offer_next_day", offsetDays: 1,   fireAtLocalHour: 9,  featuredCadenceMonths: 1, discountPercent: 35 },
  { key: "post_detail_recurring_offer_6w",   offsetDays: 42,  fireAtLocalHour: 11, featuredCadenceMonths: 1, discountPercent: 35 },
  { key: "post_detail_recurring_offer_10w",  offsetDays: 70,  fireAtLocalHour: 11, featuredCadenceMonths: 3, discountPercent: 20 },
  { key: "post_detail_recurring_offer_16w",  offsetDays: 112, fireAtLocalHour: 11, featuredCadenceMonths: 6, discountPercent: 10 },
];

export const POST_DETAIL_TOUCHPOINT_KEYS: TouchpointKey[] = POST_DETAIL_TOUCHPOINTS.map((t) => t.key);

// Eligible base service names. The booking table stores service_name as
// free text — we lowercase + trim and startsWith-match these.
const ELIGIBLE_BASE_NAMES = [
  "deluxe detail",
  "premium detail",
  "deluxe interior",
  "premium interior",
  "deluxe exterior",
  "premium exterior",
];

const EXCLUDE_KEYWORDS = ["ceramic", "correction"];

export function isEligibleServiceName(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const name = raw.trim().toLowerCase();
  if (!name) return false;
  for (const kw of EXCLUDE_KEYWORDS) {
    if (name.includes(kw)) return false;
  }
  return ELIGIBLE_BASE_NAMES.some((base) => name.startsWith(base));
}

/**
 * Compute the absolute UTC Date that this touchpoint should fire at,
 * given the booking's completion time and the shop's timezone. We pin
 * the hour-of-day in the shop's local time, not UTC, so a touchpoint
 * marked "fire at 6pm" lands at 6pm shop-local regardless of the date.
 */
function computeFireAt(completedAt: Date, offsetDays: number, fireAtLocalHour: number, timezone: string): Date {
  const offsetDate = addDays(completedAt, offsetDays);
  // Render the day in shop-local tz, then build a local datetime at the
  // chosen hour and convert back to UTC.
  const zoned = toZonedTime(offsetDate, timezone);
  const localYear = zoned.getFullYear();
  const localMonth = zoned.getMonth();
  const localDay = zoned.getDate();
  const localDate = new Date(localYear, localMonth, localDay, fireAtLocalHour, 0, 0, 0);
  // localDate is interpreted by JS as the *system* tz — convert that wall
  // time interpreted in `timezone` back to UTC.
  return fromZonedTime(localDate, timezone);
}

export type ScheduleResult = {
  scheduled: TouchpointKey[];
  skipped: "ineligible_service" | "already_recurring" | "no_contact_channels" | "booking_not_found" | null;
};

export async function schedulePostDetailTouchpoints(bookingId: string): Promise<ScheduleResult> {
  const supabase = getSupabaseAdminClient();

  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select("id, shop_id, contact_id, series_id, service_name, scheduled_start")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingErr || !booking) {
    return { scheduled: [], skipped: "booking_not_found" };
  }

  // Skip if the booking is already part of a recurring series.
  if (booking.series_id) {
    return { scheduled: [], skipped: "already_recurring" };
  }

  // Eligible service check.
  if (!isEligibleServiceName(booking.service_name)) {
    return { scheduled: [], skipped: "ineligible_service" };
  }

  // Need the shop timezone for hour-of-day pinning.
  const { data: shop } = await supabase
    .from("shops")
    .select("id, timezone")
    .eq("id", booking.shop_id)
    .maybeSingle();
  const timezone = shop?.timezone ?? "Pacific/Auckland";

  // Need the contact for at least one channel.
  let email: string | null = null;
  let phone: string | null = null;
  if (booking.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("email, phone")
      .eq("id", booking.contact_id)
      .maybeSingle();
    email = contact?.email ?? null;
    phone = contact?.phone ?? null;
  }

  if (!email && !phone) {
    return { scheduled: [], skipped: "no_contact_channels" };
  }

  // Use the booking's scheduled_start as the completion reference time.
  // Staff usually flip status=completed within hours of pickup; tying the
  // touchpoint timing to scheduled_start gives a predictable cadence.
  const completedAt = booking.scheduled_start ? new Date(booking.scheduled_start) : new Date();

  const now = new Date();
  const scheduled: TouchpointKey[] = [];

  for (const touchpoint of POST_DETAIL_TOUCHPOINTS) {
    const fireAt = computeFireAt(completedAt, touchpoint.offsetDays, touchpoint.fireAtLocalHour, timezone);
    // Don't schedule anything in the past (e.g. day0 if staff is marking
    // it completed late in the evening — the 6pm window may have passed).
    if (fireAt <= now) continue;

    const fireAtIso = fireAt.toISOString();

    if (email) {
      const { error: emailErr } = await supabase
        .from("scheduled_email_jobs")
        .upsert(
          {
            shop_id: booking.shop_id,
            booking_id: booking.id,
            contact_id: booking.contact_id,
            template_key: touchpoint.key,
            scheduled_for: fireAtIso,
            status: "pending",
          },
          { onConflict: "shop_id,booking_id,template_key", ignoreDuplicates: true }
        );
      if (emailErr) {
        console.error("schedulePostDetailTouchpoints: email job insert failed", {
          bookingId,
          touchpoint: touchpoint.key,
          error: emailErr.message,
        });
      }
    }

    if (phone) {
      // SMS jobs table doesn't carry a unique constraint everywhere, so
      // pre-check for an existing pending/sent job for the same booking +
      // touchpoint key before inserting. Idempotent in practice.
      const { data: existing } = await supabase
        .from("scheduled_sms_jobs")
        .select("id")
        .eq("shop_id", booking.shop_id)
        .eq("booking_id", booking.id)
        .eq("template_key", touchpoint.key)
        .maybeSingle();

      if (!existing) {
        const { error: smsErr } = await supabase.from("scheduled_sms_jobs").insert({
          shop_id: booking.shop_id,
          booking_id: booking.id,
          contact_id: booking.contact_id,
          phone,
          // message body is rendered at send-time by the worker (needs a
          // fresh signed token). Leave blank for now.
          message: "",
          template_key: touchpoint.key,
          scheduled_for: fireAtIso,
          status: "pending",
        });
        if (smsErr) {
          console.error("schedulePostDetailTouchpoints: sms job insert failed", {
            bookingId,
            touchpoint: touchpoint.key,
            error: smsErr.message,
          });
        }
      }
    }

    scheduled.push(touchpoint.key);
  }

  return { scheduled, skipped: null };
}

/**
 * Cancel all pending post-detail-offer touchpoints for a contact. Called
 * when the customer locks into any recurring series (post-detail offer or
 * otherwise) — once they're on a recurring plan the discount nudges are
 * moot.
 */
export async function cancelPendingTouchpointsForContact(
  shopId: string,
  contactId: string,
  reason = "Customer locked in recurring series"
): Promise<{ emailsCancelled: number; smsCancelled: number }> {
  const supabase = getSupabaseAdminClient();
  const keys = POST_DETAIL_TOUCHPOINT_KEYS;

  const { data: emailRows, error: emailErr } = await supabase
    .from("scheduled_email_jobs")
    .update({ status: "cancelled", last_error: reason })
    .eq("shop_id", shopId)
    .eq("contact_id", contactId)
    .in("template_key", keys)
    .eq("status", "pending")
    .select("id");

  if (emailErr) {
    console.error("cancelPendingTouchpointsForContact: email cancel failed", { shopId, contactId, error: emailErr.message });
  }

  const { data: smsRows, error: smsErr } = await supabase
    .from("scheduled_sms_jobs")
    .update({ status: "cancelled", last_error: reason })
    .eq("shop_id", shopId)
    .eq("contact_id", contactId)
    .in("template_key", keys)
    .eq("status", "pending")
    .select("id");

  if (smsErr) {
    console.error("cancelPendingTouchpointsForContact: sms cancel failed", { shopId, contactId, error: smsErr.message });
  }

  return {
    emailsCancelled: (emailRows ?? []).length,
    smsCancelled: (smsRows ?? []).length,
  };
}
