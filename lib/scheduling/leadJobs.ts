/**
 * Helpers for scheduling lead-related email jobs.
 *
 * All jobs land in `scheduled_email_jobs` and are processed by
 * `/api/emails/process-scheduled` (pg_cron → every minute).
 *
 * Job types:
 *   lead_auto_estimate   — 3-min delayed send of the auto-respond estimate
 *   lead_followup_3day   — 3 days after estimate sent, if still no response
 *   lead_followup_7day   — 7 days after estimate sent, final check-in
 */

import { scheduleLeadFollowupSms } from "@/lib/sms/scheduledSmsJobs";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type LeadJobType =
  | "lead_auto_estimate"
  | "lead_followup_3day"
  | "lead_followup_7day";

export type LeadAutoEstimatePayload = {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  shopId: string;
  leadId: string;
  contactId: string | null;
  templateId: string | null;
  templateKey: string;
  templateVariant: string;
};

export type LeadFollowupPayload = {
  shopId: string;
  leadId: string;
  contactId: string | null;
  email: string;
  firstName: string;
  make: string | null;
  model: string | null;
};

/** Schedule a lead job. scheduledFor is ISO string. */
export async function scheduleLeadJob(args: {
  shopId: string;
  leadId: string;
  contactId: string | null;
  jobType: LeadJobType;
  templateKey: string;
  scheduledFor: string;
  payload: LeadAutoEstimatePayload | LeadFollowupPayload;
}) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("scheduled_email_jobs").insert({
    shop_id: args.shopId,
    lead_id: args.leadId,
    contact_id: args.contactId,
    booking_id: null,
    job_type: args.jobType,
    template_key: args.templateKey,
    scheduled_for: args.scheduledFor,
    payload_json: args.payload,
    status: "pending",
  });

  if (error) {
    throw new Error(`Failed to schedule ${args.jobType}: ${error.message}`);
  }
}

/**
 * Convenience: schedule both 3-day and 7-day follow-ups for a lead whose
 * estimate has just been sent.
 */
export async function scheduleLeadFollowups(args: {
  shopId: string;
  leadId: string;
  contactId: string | null;
  email: string;
  phone?: string | null;
  firstName: string;
  make: string | null;
  model: string | null;
}) {
  const now = Date.now();
  const in3Days = new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString();
  const in7Days = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();

  const basePayload = {
    shopId: args.shopId,
    leadId: args.leadId,
    contactId: args.contactId,
    email: args.email,
    firstName: args.firstName,
    make: args.make,
    model: args.model,
  };

  // Email at +3 days
  await scheduleLeadJob({
    shopId: args.shopId,
    leadId: args.leadId,
    contactId: args.contactId,
    jobType: "lead_followup_3day",
    templateKey: "lead_followup_3day",
    scheduledFor: in3Days,
    payload: basePayload,
  });

  // SMS at +5 days (between the 2 emails) — only if we have a phone
  if (args.phone) {
    const vehicleLabel = [args.make, args.model].filter(Boolean).join(" ") || null;
    try {
      await scheduleLeadFollowupSms({
        leadId: args.leadId,
        contactId: args.contactId,
        shopId: args.shopId,
        phone: args.phone,
        firstName: args.firstName,
        vehicleLabel,
      });
    } catch (e) {
      console.error("Lead follow-up SMS scheduling failed (non-fatal)", e);
    }
  }

  // Email at +7 days
  await scheduleLeadJob({
    shopId: args.shopId,
    leadId: args.leadId,
    contactId: args.contactId,
    jobType: "lead_followup_7day",
    templateKey: "lead_followup_7day",
    scheduledFor: in7Days,
    payload: basePayload,
  });
}

/**
 * Cancel any pending lead jobs for a lead (e.g. when they book, so we
 * don't pester them with follow-ups). Cancels both email and SMS jobs.
 */
export async function cancelLeadJobs(leadId: string, jobTypes?: LeadJobType[]) {
  const supabase = getSupabaseAdminClient();

  // Cancel email follow-up jobs
  const emailQuery = supabase
    .from("scheduled_email_jobs")
    .update({ status: "cancelled", last_error: "Cancelled — lead converted" })
    .eq("lead_id", leadId)
    .eq("status", "pending");

  if (jobTypes && jobTypes.length > 0) {
    emailQuery.in("job_type", jobTypes);
  }

  const { error: emailErr } = await emailQuery;
  if (emailErr) {
    console.error("Failed to cancel lead email jobs", { leadId, error: emailErr });
  }

  // Also cancel any pending lead-context SMS jobs for this lead
  const { error: smsErr } = await supabase
    .from("scheduled_sms_jobs")
    .update({ status: "cancelled", last_error: "Cancelled — lead converted" })
    .eq("lead_id", leadId)
    .eq("status", "pending");

  if (smsErr) {
    console.error("Failed to cancel lead SMS jobs", { leadId, error: smsErr });
  }
}
