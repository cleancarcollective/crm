import { addDays, addHours, addWeeks } from "date-fns";

import { getBookingWithRelationsById, getShopById } from "@/lib/dashboard/bookings";
import type { ShopRecord } from "@/lib/dashboard/types";
import { sendBookingConfirmationEmail } from "@/lib/email/sendBookingConfirmation";
import type { EmailTemplateKey, ScheduledEmailJobRecord } from "@/lib/email/types";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const REMINDER_DEFINITIONS = [
  {
    templateKey: "booking-reminder-week" as const,
    offset: (scheduledStart: Date) => addWeeks(scheduledStart, -1),
    actionLine: "If anything has changed, reply to this email."
  },
  {
    templateKey: "booking-reminder-day" as const,
    offset: (scheduledStart: Date) => addDays(scheduledStart, -1),
    actionLine: "If anything has changed, reply to this email."
  },
  {
    templateKey: "booking-reminder-hour" as const,
    offset: (scheduledStart: Date) => addHours(scheduledStart, -1),
    actionLine: "We look forward to seeing you shortly."
  }
];

function getReminderIntroLine(templateKey: EmailTemplateKey, shopName: string): string {
  switch (templateKey) {
    case "booking-reminder-week":
      return `This is your one-week reminder for your upcoming booking with ${shopName}.`;
    case "booking-reminder-day":
      return `This is your one-day reminder for your upcoming booking with ${shopName}.`;
    case "booking-reminder-hour":
      return `This is your one-hour reminder for your upcoming booking with ${shopName}.`;
    default:
      return `A reminder about your upcoming booking with ${shopName}.`;
  }
}

export async function createReminderJobsForBooking({
  shop,
  bookingId,
  contactId,
  scheduledStart
}: {
  shop: ShopRecord;
  bookingId: string;
  contactId: string | null;
  scheduledStart: string;
}) {
  const scheduledStartDate = new Date(scheduledStart);
  const now = new Date();

  const jobsToInsert = REMINDER_DEFINITIONS
    .map((definition) => ({
      shop_id: shop.id,
      booking_id: bookingId,
      contact_id: contactId,
      template_key: definition.templateKey,
      scheduled_for: definition.offset(scheduledStartDate).toISOString(),
      status: "pending" as const
    }))
    .filter((job) => new Date(job.scheduled_for) > now);

  if (jobsToInsert.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("scheduled_email_jobs")
    .upsert(jobsToInsert, {
      onConflict: "shop_id,booking_id,template_key",
      ignoreDuplicates: false
    })
    .select("*");

  if (error) {
    throw error;
  }

  return (data ?? []) as ScheduledEmailJobRecord[];
}

export async function processScheduledReminderJobs() {
  const nowIso = new Date().toISOString();
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("scheduled_email_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(50);

  if (error) {
    throw error;
  }

  const jobs = (data ?? []) as ScheduledEmailJobRecord[];
  const results: Array<{ jobId: string; bookingId: string | null; status: string; templateKey: EmailTemplateKey }> = [];

  for (const job of jobs) {
    const claimedJob = await claimScheduledJob(job.id);

    if (!claimedJob) {
      continue;
    }

    try {
      if (!claimedJob.booking_id) {
        await updateScheduledJobStatus(claimedJob.id, "skipped", "Missing booking_id on scheduled job.");
        results.push({
          jobId: claimedJob.id,
          bookingId: null,
          status: "skipped:missing_booking",
          templateKey: claimedJob.template_key
        });
        continue;
      }

      const [bookingData, shop] = await Promise.all([
        getBookingWithRelationsById(claimedJob.booking_id, claimedJob.shop_id),
        getShopById(claimedJob.shop_id)
      ]);

      if (!bookingData) {
        await updateScheduledJobStatus(claimedJob.id, "skipped", "Booking not found.");
        results.push({
          jobId: claimedJob.id,
          bookingId: claimedJob.booking_id,
          status: "skipped:booking_not_found",
          templateKey: claimedJob.template_key
        });
        continue;
      }

      if (["cancelled", "completed", "no_show"].includes(bookingData.status)) {
        await updateScheduledJobStatus(claimedJob.id, "cancelled", `Booking status is ${bookingData.status}.`);
        results.push({
          jobId: claimedJob.id,
          bookingId: claimedJob.booking_id,
          status: `cancelled:${bookingData.status}`,
          templateKey: claimedJob.template_key
        });
        continue;
      }

      const reminderDefinition = REMINDER_DEFINITIONS.find(
        (definition) => definition.templateKey === claimedJob.template_key
      );

      if (!reminderDefinition) {
        await updateScheduledJobStatus(claimedJob.id, "failed", "Unknown reminder template key.");
        results.push({
          jobId: claimedJob.id,
          bookingId: claimedJob.booking_id,
          status: "failed:unknown_template",
          templateKey: claimedJob.template_key
        });
        continue;
      }

      const sendResult = await sendBookingConfirmationEmail({
        shop,
        booking: bookingData,
        templateKey: claimedJob.template_key,
        introLine: getReminderIntroLine(claimedJob.template_key, shop.name),
        actionLine: reminderDefinition.actionLine
      });

      if (sendResult.skipped) {
        await updateScheduledJobStatus(claimedJob.id, "skipped", sendResult.reason);
        results.push({
          jobId: claimedJob.id,
          bookingId: claimedJob.booking_id,
          status: `skipped:${sendResult.reason}`,
          templateKey: claimedJob.template_key
        });
      } else {
        await markScheduledJobSent(claimedJob.id, sendResult.emailMessageId);
        results.push({
          jobId: claimedJob.id,
          bookingId: claimedJob.booking_id,
          status: "sent",
          templateKey: claimedJob.template_key
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown reminder processing error.";
      await updateScheduledJobStatus(claimedJob.id, "failed", message);
      results.push({
        jobId: claimedJob.id,
        bookingId: claimedJob.booking_id,
        status: "failed",
        templateKey: claimedJob.template_key
      });
    }
  }

  return results;
}

async function claimScheduledJob(id: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("scheduled_email_jobs")
    .update({
      status: "processing",
      attempt_count: 1
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as ScheduledEmailJobRecord | null) ?? null;
}

async function updateScheduledJobStatus(id: string, status: ScheduledEmailJobRecord["status"], lastError: string | null) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("scheduled_email_jobs")
    .update({
      status,
      last_error: lastError
    })
    .eq("id", id);

  if (error) {
    throw error;
  }
}

async function markScheduledJobSent(id: string, emailMessageId: string) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("scheduled_email_jobs")
    .update({
      status: "sent",
      email_message_id: emailMessageId,
      last_error: null
    })
    .eq("id", id);

  if (error) {
    throw error;
  }
}
