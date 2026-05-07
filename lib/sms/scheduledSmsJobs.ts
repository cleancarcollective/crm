import { addDays, addHours } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { getShopContactsById } from "@/lib/email/shopContacts";
import { loadAndRenderSms } from "@/lib/sms/smsTemplateRenderer";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { sendTnzSms } from "@/lib/sms/tnzClient";

const REVIEW_DELAY_HOURS = 23;
const LEAD_FOLLOWUP_SMS_DAYS = 5;

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
  const { body: message } = await loadAndRenderSms(shopId, "booking_reminder_day", {
    name: firstName,
    date_time: dateLabel,
  });

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
 * T+5 days lead follow-up SMS — slots in between the 3-day and 7-day
 * follow-up emails. Per-shop sender name (Ben for Christchurch, etc).
 */
export async function scheduleLeadFollowupSms({
  leadId,
  contactId,
  shopId,
  phone,
  firstName,
  vehicleLabel,
}: {
  leadId: string;
  contactId: string | null;
  shopId: string;
  phone: string;
  firstName: string;
  vehicleLabel: string | null;
}) {
  const scheduledFor = addDays(new Date(), LEAD_FOLLOWUP_SMS_DAYS).toISOString();

  // Resolve sender name now so the SMS reads correctly when it fires
  const shopContacts = await getShopContactsById(shopId);
  const { body: message } = await loadAndRenderSms(shopId, "lead_followup_5day", {
    name: firstName,
    vehicle: vehicleLabel ?? "your vehicle",
    senderName: shopContacts.sender_name,
  });

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("scheduled_sms_jobs").insert({
    shop_id: shopId,
    lead_id: leadId,
    booking_id: null,
    contact_id: contactId,
    phone,
    message,
    scheduled_for: scheduledFor,
    status: "pending",
  });

  if (error) {
    console.error("Failed to schedule lead follow-up SMS", { leadId, error });
    throw error;
  }

  console.info("Lead follow-up SMS scheduled", { leadId, scheduledFor });
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
  const { body: message } = await loadAndRenderSms(shopId, "review_request", {
    name: firstName,
  });

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
export async function processScheduledSmsJobs(): Promise<Array<{ id: string; status: "sent" | "failed" | "skipped"; error?: string }>> {
  const supabase = getSupabaseAdminClient();

  const { data: jobs, error } = await supabase
    .from("scheduled_sms_jobs")
    .select("id, phone, message, booking_id, lead_id, shop_id, contact_id")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .limit(50);

  if (error) {
    console.error("Failed to fetch scheduled SMS jobs", error);
    throw error;
  }

  if (!jobs || jobs.length === 0) return [];

  const results: Array<{ id: string; status: "sent" | "failed" | "skipped"; error?: string }> = [];

  for (const job of jobs) {
    // Lead-context jobs: re-check the lead hasn't already converted
    // before we fire the SMS. Same defensive pattern as the email
    // follow-up handler — covers cancelLeadJobs failure modes.
    if (job.lead_id) {
      const skipReason = await shouldSkipLeadSms(job);
      if (skipReason) {
        await supabase
          .from("scheduled_sms_jobs")
          .update({ status: "cancelled", last_error: skipReason })
          .eq("id", job.id);
        console.info("Lead SMS skipped", { jobId: job.id, leadId: job.lead_id, reason: skipReason });
        results.push({ id: job.id as string, status: "skipped" });
        continue;
      }
    }

    const result = await sendTnzSms(job.phone as string, job.message as string);

    if (result.success) {
      await supabase
        .from("scheduled_sms_jobs")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", job.id);

      console.info("Scheduled SMS sent", { jobId: job.id, bookingId: job.booking_id, leadId: job.lead_id });
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

/**
 * Defensive pre-send check for lead-context SMS jobs. Returns a reason
 * string if the SMS should be skipped, otherwise null.
 *
 * Mirrors the email follow-up handler's logic: skip if the lead is no
 * longer 'sent' (already converted/lost), OR if a contact with the same
 * email/phone has any recent confirmed/completed booking.
 */
async function shouldSkipLeadSms(job: {
  lead_id: string | null;
  shop_id: string;
  contact_id: string | null;
}): Promise<string | null> {
  if (!job.lead_id) return null;
  const supabase = getSupabaseAdminClient();

  // 1. Lead status gate
  const { data: lead } = await supabase
    .from("leads")
    .select("status, template_id")
    .eq("id", job.lead_id)
    .maybeSingle();

  if (!lead) return "lead not found";
  if (lead.status !== "sent") return `lead.status = ${lead.status}`;

  // 2. Contact-already-booked gate (catches different-email bookings)
  if (job.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("email, phone")
      .eq("id", job.contact_id)
      .maybeSingle();

    if (contact && (contact.email || contact.phone)) {
      const orParts = [
        contact.email ? `email.eq.${contact.email}` : null,
        contact.phone ? `phone.eq.${contact.phone}` : null,
      ].filter(Boolean);

      const { data: matchingContacts } = await supabase
        .from("contacts")
        .select("id")
        .eq("shop_id", job.shop_id)
        .or(orParts.join(","));

      const ids = (matchingContacts ?? []).map((c) => c.id as string);
      if (ids.length > 0) {
        const { count } = await supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", job.shop_id)
          .in("contact_id", ids)
          .in("status", ["pending", "confirmed", "completed"])
          .gte(
            "scheduled_start",
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
          );

        if ((count ?? 0) > 0) {
          // Back-fix the lead to keep the funnel honest
          await supabase
            .from("leads")
            .update({
              status: "won",
              won_source: lead.template_id ? "auto_email" : "direct_booking",
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.lead_id);
          return "contact has a recent booking";
        }
      }
    }
  }

  return null;
}
