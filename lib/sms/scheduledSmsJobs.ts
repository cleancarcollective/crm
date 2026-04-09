import { addHours } from "date-fns";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { sendTnzSms } from "@/lib/sms/tnzClient";

const REVIEW_DELAY_HOURS = 23;

const REVIEW_SMS_TEMPLATE = (firstName: string) =>
  `Hey ${firstName}, thanks again for choosing Clean Car Collective! We'd love your quick feedback - just tap here: https://cleancarcollective.co.nz/how-did-we-do/`;

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
