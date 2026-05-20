import { addDays, addHours, addWeeks } from "date-fns";

import { getBookingWithRelationsById, getShopById } from "@/lib/dashboard/bookings";
import type { ShopRecord } from "@/lib/dashboard/types";
import { sendBookingConfirmationEmail } from "@/lib/email/sendBookingConfirmation";
import { sendPostDetailOfferEmail } from "@/lib/email/sendPostDetailOffer";
import { POST_DETAIL_TOUCHPOINTS } from "@/lib/bookings/postDetailTouchpoints";
import type { EmailTemplateKey, ScheduledEmailJobRecord } from "@/lib/email/types";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const POST_DETAIL_TOUCHPOINT_TEMPLATE_KEYS = new Set<EmailTemplateKey>([
  "post_detail_recurring_offer_day0",
  "post_detail_recurring_offer_6w",
  "post_detail_recurring_offer_10w",
  "post_detail_recurring_offer_16w",
]);

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
      return `Just a heads-up that your booking with ${shopName} is coming up in a week.`;
    case "booking-reminder-day":
      return `Quick reminder - your booking with ${shopName} is tomorrow.`;
    case "booking-reminder-hour":
      return `You're booked in with ${shopName} in about an hour.`;
    default:
      return `A quick reminder about your upcoming booking with ${shopName}.`;
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

  // Anything scheduled within the next 5 minutes is treated as "due now" -
  // the cron processes it on the next tick. This avoids a millisecond-race
  // for bookings made very close to a reminder boundary (e.g. exactly 7d
  // out: the week-reminder offset lands within microseconds of `now` and
  // gets dropped). 5 minutes is short enough that a customer will perceive
  // the reminder as roughly-instant if it does happen to fire.
  const nowMinus5Min = new Date(now.getTime() - 5 * 60 * 1000);
  const jobsToInsert = REMINDER_DEFINITIONS
    .map((definition) => ({
      shop_id: shop.id,
      booking_id: bookingId,
      contact_id: contactId,
      template_key: definition.templateKey,
      scheduled_for: definition.offset(scheduledStartDate).toISOString(),
      status: "pending" as const
    }))
    .filter((job) => new Date(job.scheduled_for) > nowMinus5Min);

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
  // Only handle booking reminders. Lead-context jobs (job_type IS NOT NULL)
  // are processed by /api/emails/process-scheduled's lead handler - including
  // them here causes them to be bogusly marked "skipped: Missing booking_id".
  const { data, error } = await supabase
    .from("scheduled_email_jobs")
    .select("*")
    .eq("status", "pending")
    .is("job_type", null)
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

      // Post-detail touchpoints are TRIGGERED by status='completed' — they
      // must fire even when the booking is in that state. Other reminders
      // shouldn't fire post-cancellation/post-completion.
      const isPostDetailTouchpoint = POST_DETAIL_TOUCHPOINT_TEMPLATE_KEYS.has(claimedJob.template_key);
      const cancelStatuses = isPostDetailTouchpoint ? ["cancelled", "no_show"] : ["cancelled", "completed", "no_show"];
      if (cancelStatuses.includes(bookingData.status)) {
        await updateScheduledJobStatus(claimedJob.id, "cancelled", `Booking status is ${bookingData.status}.`);
        results.push({
          jobId: claimedJob.id,
          bookingId: claimedJob.booking_id,
          status: `cancelled:${bookingData.status}`,
          templateKey: claimedJob.template_key
        });
        continue;
      }

      // Post-detail recurring-offer touchpoints route to their own renderer.
      if (POST_DETAIL_TOUCHPOINT_TEMPLATE_KEYS.has(claimedJob.template_key)) {
        const contact = bookingData.contact;
        if (!contact?.email) {
          await updateScheduledJobStatus(claimedJob.id, "skipped", "Contact has no email for post-detail offer.");
          results.push({
            jobId: claimedJob.id,
            bookingId: claimedJob.booking_id,
            status: "skipped:no_email",
            templateKey: claimedJob.template_key
          });
          continue;
        }
        const touchpoint = POST_DETAIL_TOUCHPOINTS.find((t) => t.key === claimedJob.template_key);
        if (!touchpoint) {
          await updateScheduledJobStatus(claimedJob.id, "failed", "Unknown post-detail touchpoint key.");
          results.push({
            jobId: claimedJob.id,
            bookingId: claimedJob.booking_id,
            status: "failed:unknown_template",
            templateKey: claimedJob.template_key
          });
          continue;
        }
        try {
          const sendResult = await sendPostDetailOfferEmail({
            shop,
            bookingId: bookingData.id,
            contact: {
              firstName: contact.first_name ?? contact.full_name?.split(" ")[0] ?? null,
              email: contact.email,
            },
            serviceName: bookingData.service_name,
            basePrice: bookingData.price_estimate ?? null,
            touchpointKey: touchpoint.key,
            featuredCadenceMonths: touchpoint.featuredCadenceMonths,
            featuredDiscountPercent: touchpoint.discountPercent,
          });
          await markScheduledJobSent(claimedJob.id, sendResult.providerMessageId ?? "");
          results.push({
            jobId: claimedJob.id,
            bookingId: claimedJob.booking_id,
            status: "sent",
            templateKey: claimedJob.template_key
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Post-detail offer send failed";
          await updateScheduledJobStatus(claimedJob.id, "failed", msg);
          results.push({
            jobId: claimedJob.id,
            bookingId: claimedJob.booking_id,
            status: "failed",
            templateKey: claimedJob.template_key
          });
        }
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
