import { addDays, addHours } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { sendTnzSms } from "@/lib/sms/tnzClient";

const REVIEW_DELAY_HOURS = 23;

const REVIEW_SMS_TEMPLATE = (firstName: string) =>
  `Hey ${firstName}, thanks again for choosing Clean Car Collective! We'd love your quick feedback - just tap here: https://cleancarcollective.co.nz/how-did-we-do/`;

/**
 * T-1 day booking reminder SMS. Fires 24h before scheduled_start so the
 * customer gets a friendly nudge. Date formatted in the shop's timezone
 * for clarity ("Thu 25 Apr at 2:00 pm").
 */
function buildBookingReminderSms(firstName: string, dateLabel: string): string {
  return `Hi ${firstName}, friendly reminder - your Clean Car Collective booking is tomorrow, ${dateLabel}. Reply if anything's changed. See you soon!`;
}

/**
 * Schedule a day-before booking reminder SMS.
 * Skips if the booking is already within 24h of creation (reminder would be
 * in the past). Same SMS job table as the review SMS — both processed by
 * processScheduledSmsJobs().
 */
export async function scheduleBookingReminderSms({
  bookingId,
  contactId,
  shopId,
  phone,
  firstName,
  scheduledStart,
  timezone,
}: {
  bookingId: string;
  contactId: string | null;
  shopId: string;
  phone: string;
  firstName: string;
  scheduledStart: string;
  timezone: string;
}) {
  const reminderAt = addDays(new Date(scheduledStart), -1);
  if (reminderAt <= new Date()) {
    console.info("Skipping booking reminder SMS — reminder time is in the past", {
      bookingId,
      scheduledStart,
    });
    return;
  }

  const dateLabel = formatInTimeZone(
    new Date(scheduledStart),
    timezone,
    "EEE d MMM 'at' h:mm a"
  );
  const message = buildBookingReminderSms(firstName, dateLabel);

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("scheduled_sms_jobs").insert({
    shop_id: shopId,
    booking_id: bookingId,
    contact_id: contactId,
    phone,
    message,
    scheduled_for: reminderAt.toISOString(),
    status: "pending",
  });

  if (error) {
    console.error("Failed to schedule booking reminder SMS", { bookingId, error });
    throw error;
  }

  console.info("Booking reminder SMS scheduled", {
    bookingId,
    scheduledFor: reminderAt.toISOString(),
  });
}

/**
 * Schedule a review SMS to be sent ~23 hours after pick-up.
 */
export async function scheduleReviewSms({
  bookingId,
  contactId,
  shopId,
  phone,
  firstName,
}: {
  bookingId: string;
  contactId: string | null;
  shopId: string;
  phone: string;
  firstName: string;
}) {
  const supabase = getSupabaseAdminClient();
  const scheduledFor = addHours(new Date(), REVIEW_DELAY_HOURS).toISOString();
  const message = REVIEW_SMS_TEMPLATE(firstName);

  const { error } = await supabase.from("scheduled_sms_jobs").insert({
    shop_id: shopId,
    booking_id: bookingId,
    contact_id: contactId,
    phone,
    message,
    scheduled_for: scheduledFor,
    status: "pending",
  });

  if (error) {
    console.error("Failed to schedule review SMS", { bookingId, error });
    throw error;
  }

  console.info("Review SMS scheduled", { bookingId, scheduledFor });
}

/**
 * Process all pending SMS jobs that are due. Called by cron.
 * Returns a summary of what was sent / failed.
 */
export async function processScheduledSmsJobs(): Promise<Array<{ id: string; status: "sent" | "failed"; error?: string }>> {
  const supabase = getSupabaseAdminClient();

  const { data: jobs, error } = await supabase
    .from("scheduled_sms_jobs")
    .select("id, phone, message, booking_id")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .limit(50);

  if (error) {
    console.error("Failed to fetch scheduled SMS jobs", error);
    throw error;
  }

  if (!jobs || jobs.length === 0) return [];

  const results: Array<{ id: string; status: "sent" | "failed"; error?: string }> = [];

  for (const job of jobs) {
    const result = await sendTnzSms(job.phone as string, job.message as string);

    if (result.success) {
      await supabase
        .from("scheduled_sms_jobs")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", job.id);

      console.info("Scheduled SMS sent", { jobId: job.id, bookingId: job.booking_id });
      results.push({ id: job.id as string, status: "sent" });
    } else {
      await supabase
        .from("scheduled_sms_jobs")
        .update({ status: "failed", last_error: result.error })
        .eq("id", job.id);

      console.error("Scheduled SMS failed", { jobId: job.id, error: result.error });
      results.push({ id: job.id as string, status: "failed", error: result.error });
    }
  }

  return results;
}
