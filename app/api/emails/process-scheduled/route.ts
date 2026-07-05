/**
 * Minute-cadence scheduled job processor.
 *
 * Called by Supabase pg_cron every minute with Bearer <CRON_SECRET>.
 *
 * Processes ALL pending jobs in scheduled_email_jobs where scheduled_for
 * <= now(). Dispatches based on job_type OR template_key (legacy booking
 * reminders don't have job_type set).
 *
 * Handlers:
 *   lead_auto_estimate      — send the 3-min-delayed estimate + schedule follow-ups
 *   lead_followup_3day      — if lead still not converted, send follow-up
 *   lead_followup_7day      — if lead still not converted, send final follow-up
 *   booking-reminder-*      — legacy booking reminders (delegated to existing handler)
 */

import { NextResponse } from "next/server";

import { sendEstimateEmail, type SendEstimateArgs } from "@/lib/autorespond/processLead";
import {
  renderAdNurtureEmail,
  type AdNurtureJobType,
  type AdNurturePayload,
} from "@/lib/autorespond/adNurture";
import {
  buildTemplateContext,
  loadAndRenderTemplate,
} from "@/lib/autorespond/templateRenderer";
import type { TemplateKey } from "@/lib/autorespond/templates";
import { processScheduledReminderJobs } from "@/lib/email/scheduledReminderJobs";
import { scheduleLeadFollowups } from "@/lib/scheduling/leadJobs";
import { processScheduledSmsJobs } from "@/lib/sms/scheduledSmsJobs";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("Missing CRON_SECRET env var");
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${cronSecret}`;
}

type ScheduledJob = {
  id: string;
  shop_id: string;
  lead_id: string | null;
  contact_id: string | null;
  booking_id: string | null;
  job_type: string | null;
  template_key: string;
  scheduled_for: string;
  status: string;
  attempt_count: number;
  payload_json: Record<string, unknown> | null;
};

const MAX_ATTEMPTS = 3;

// POST or GET — pg_cron calls POST, manual test calls GET
export async function GET(request: Request) {
  return handle(request);
}
export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();

  // Pick up due lead jobs (job_type IS NOT NULL). Legacy booking reminders
  // are delegated to the existing function below.
  const nowIso = new Date().toISOString();
  const { data: jobs, error } = await supabase
    .from("scheduled_email_jobs")
    .select("*")
    .eq("status", "pending")
    .not("job_type", "is", null)
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ jobId: string; jobType: string | null; status: string; error?: string }> = [];

  for (const job of (jobs ?? []) as ScheduledJob[]) {
    // Claim: flip to 'processing' only if still pending (avoids double-runs)
    const { data: claimed } = await supabase
      .from("scheduled_email_jobs")
      .update({ status: "processing" })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (!claimed) continue; // another worker got it

    try {
      await dispatch(job);
      await supabase
        .from("scheduled_email_jobs")
        .update({
          status: "sent",
          attempt_count: job.attempt_count + 1,
          last_error: null,
        })
        .eq("id", job.id);
      results.push({ jobId: job.id, jobType: job.job_type, status: "sent" });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const nextAttempt = job.attempt_count + 1;
      const isFinalAttempt = nextAttempt >= MAX_ATTEMPTS;

      // Exponential backoff for retries: 2, 4, 8 min
      const backoffMs = Math.pow(2, nextAttempt) * 60 * 1000;
      const retryAt = new Date(Date.now() + backoffMs).toISOString();

      await supabase
        .from("scheduled_email_jobs")
        .update({
          status: isFinalAttempt ? "failed" : "pending",
          attempt_count: nextAttempt,
          last_error: errMsg,
          ...(isFinalAttempt ? {} : { scheduled_for: retryAt }),
        })
        .eq("id", job.id);

      console.error(`Scheduled job ${job.id} (${job.job_type}) failed:`, errMsg);
      results.push({ jobId: job.id, jobType: job.job_type, status: isFinalAttempt ? "failed" : "retry", error: errMsg });
    }
  }

  // Track sub-processor failures so we can return a non-2xx to pg_cron at
  // the end. Without this, a silently-throwing sub-processor (e.g. SELECT
  // against a missing column) reads as "succeeded" in cron.job_run_details
  // forever - which is exactly how the 2026-05-20 stale-SMS incident hid
  // for 26 days. Subprocessor errors now surface to the cron monitoring.
  const subprocessorErrors: Array<{ processor: string; error: string }> = [];

  // Booking reminder processor (job_type IS NULL rows)
  let bookingResults: unknown[] = [];
  try {
    bookingResults = await processScheduledReminderJobs();
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("Booking reminder processor failed:", errMsg);
    subprocessorErrors.push({ processor: "booking_reminders", error: errMsg });
  }

  // SMS jobs (booking reminders, review SMS) - same scheduler pattern,
  // runs every minute via pg_cron now rather than daily via Vercel cron.
  let smsResults: unknown[] = [];
  try {
    smsResults = await processScheduledSmsJobs();
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("SMS job processor failed:", errMsg);
    subprocessorErrors.push({ processor: "sms_jobs", error: errMsg });
  }

  const body = {
    success: subprocessorErrors.length === 0,
    leadJobsProcessed: results.length,
    leadResults: results,
    bookingRemindersProcessed: bookingResults.length,
    smsJobsProcessed: smsResults.length,
    ...(subprocessorErrors.length > 0 ? { errors: subprocessorErrors } : {}),
  };

  // 500 on any sub-processor failure so pg_cron job_run_details shows
  // "failed" instead of silently succeeding, and the health-check alert
  // (B) escalates promptly.
  return NextResponse.json(body, { status: subprocessorErrors.length === 0 ? 200 : 500 });
}

// ── Dispatcher ────────────────────────────────────────────────────────────

async function dispatch(job: ScheduledJob) {
  switch (job.job_type) {
    case "lead_auto_estimate":
      return handleLeadAutoEstimate(job);
    case "lead_followup_3day":
    case "lead_followup_7day":
    case "lead_followup_30day":
      return handleLeadFollowup(job);
    case "ad_nurture_day1":
    case "ad_nurture_day3":
    case "ad_nurture_day6":
      return handleAdNurture(job);
    default:
      throw new Error(`Unknown job_type: ${job.job_type}`);
  }
}

/**
 * Defensive booking check shared by the lead follow-up + ad-nurture handlers:
 * if the contact's email OR phone has a recent confirmed booking for this
 * shop, the lead converted (possibly under a different contact row) and the
 * follow-up must not send. Back-fixes lead.status='won' when it fires.
 */
async function contactHasRecentBooking(
  job: ScheduledJob,
  contact: { email: string | null; phone: string | null } | null,
  leadTemplateId: string | null
): Promise<boolean> {
  if (!contact || (!contact.email && !contact.phone)) return false;
  const supabase = getSupabaseAdminClient();

  const { data: matchingContacts } = await supabase
    .from("contacts")
    .select("id")
    .eq("shop_id", job.shop_id)
    .or(
      [
        contact.email ? `email.eq.${contact.email}` : null,
        contact.phone ? `phone.eq.${contact.phone}` : null,
      ]
        .filter(Boolean)
        .join(",")
    );

  const contactIds = (matchingContacts ?? []).map((c) => c.id as string);
  if (contactIds.length === 0) return false;

  const { count: recentBookings } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", job.shop_id)
    .in("contact_id", contactIds)
    .in("status", ["pending", "confirmed", "completed"])
    .gte("scheduled_start", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if ((recentBookings ?? 0) === 0) return false;

  console.info(`${job.job_type}: skipping — contact has a recent booking despite open lead`, {
    leadId: job.lead_id,
    email: contact.email,
    phone: contact.phone,
  });
  if (job.lead_id) {
    await supabase
      .from("leads")
      .update({
        status: "won",
        won_source: leadTemplateId ? "auto_email" : "direct_booking",
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.lead_id);
  }
  return true;
}

/**
 * Ad-lead nurture touches (3 emails over 6 days, promo-landing leads only).
 * Renders from the payload snapshot taken at quote time; every touch
 * re-checks the lead at send time so status changes, bookings, bounces and
 * cooldowns all pull the lead out of the sequence.
 */
async function handleAdNurture(job: ScheduledJob) {
  if (!job.lead_id) throw new Error(`${job.job_type}: missing lead_id`);
  const payload = job.payload_json as unknown as AdNurturePayload | null;
  if (!payload) throw new Error(`${job.job_type}: missing payload`);
  const supabase = getSupabaseAdminClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("status, email_bounced_at, cooldown_until, template_id")
    .eq("id", job.lead_id)
    .maybeSingle();

  if (!lead) throw new Error(`${job.job_type}: lead not found`);
  if (lead.status !== "sent") {
    console.info(`${job.job_type}: skipping, lead status is ${lead.status}`, { leadId: job.lead_id });
    return;
  }
  if (lead.email_bounced_at) {
    console.info(`${job.job_type}: skipping, estimate email bounced`, { leadId: job.lead_id });
    return;
  }
  if (lead.cooldown_until && Date.parse(lead.cooldown_until as string) > Date.now()) {
    console.info(`${job.job_type}: skipping, lead in cooldown`, { leadId: job.lead_id });
    return;
  }

  const { data: contact } = job.contact_id
    ? await supabase.from("contacts").select("first_name, email, phone").eq("id", job.contact_id).maybeSingle()
    : { data: null };

  if (await contactHasRecentBooking(job, contact, (lead.template_id as string | null) ?? null)) {
    return;
  }

  const email = contact?.email ?? payload.email;
  if (!email) throw new Error(`${job.job_type}: no email for lead`);

  const { getShopContactsById } = await import("@/lib/email/shopContacts");
  const contacts = await getShopContactsById(job.shop_id);
  const { data: shopRow } = await supabase.from("shops").select("slug").eq("id", job.shop_id).maybeSingle();

  const rendered = renderAdNurtureEmail(
    job.job_type as AdNurtureJobType,
    { ...payload, firstName: contact?.first_name ?? payload.firstName },
    (shopRow?.slug as string) ?? "christchurch",
    contacts.sender_name
  );

  await sendEstimateEmail({
    to: email,
    subject: rendered.subject,
    textBody: rendered.textBody,
    htmlBody: rendered.htmlBody,
    shopId: job.shop_id,
    leadId: job.lead_id,
    contactId: job.contact_id,
    templateId: null,
    templateKey: job.job_type ?? "ad_nurture",
    templateVariant: "default",
  });
}

// ── Handlers ──────────────────────────────────────────────────────────────

async function handleLeadAutoEstimate(job: ScheduledJob) {
  if (!job.lead_id) throw new Error("lead_auto_estimate: missing lead_id");
  const payload = job.payload_json as SendEstimateArgs | null;
  if (!payload) throw new Error("lead_auto_estimate: missing payload");

  const supabase = getSupabaseAdminClient();

  // Check the lead is still in 'scheduled' state. If something else flipped
  // it (manual intervention, cancelled, etc), don't send.
  const { data: lead } = await supabase
    .from("leads")
    .select("status")
    .eq("id", job.lead_id)
    .maybeSingle();

  if (!lead) throw new Error("lead_auto_estimate: lead not found");
  if (lead.status !== "scheduled") {
    // Lead was manually actioned — skip send but mark job as sent so we don't retry
    console.info("lead_auto_estimate: skipping, lead no longer scheduled", {
      leadId: job.lead_id,
      status: lead.status,
    });
    return;
  }

  // Actually send via the same function used for immediate sends
  await sendEstimateEmail(payload);

  // Flip lead to 'sent'
  await supabase
    .from("leads")
    .update({
      status: "sent",
      internal_notes: "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.lead_id);

  // Fetch contact for follow-up rendering later (firstName + phone for SMS)
  let firstName = "there";
  let phone: string | null = null;
  if (job.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("first_name, phone")
      .eq("id", job.contact_id)
      .maybeSingle();
    firstName = contact?.first_name ?? "there";
    phone = contact?.phone ?? null;
  }

  // Fetch vehicle for SMS message body ("the {make model} detailing estimate")
  let make: string | null = null;
  let model: string | null = null;
  const { data: leadRow } = await supabase
    .from("leads")
    .select("vehicle_id, vehicles(make, model)")
    .eq("id", job.lead_id)
    .maybeSingle();
  if (leadRow?.vehicles) {
    const v = leadRow.vehicles as unknown as { make: string | null; model: string | null };
    make = v.make;
    model = v.model;
  }

  await scheduleLeadFollowups({
    shopId: job.shop_id,
    leadId: job.lead_id,
    contactId: job.contact_id,
    email: payload.to,
    phone,
    firstName,
    make,
    model,
  });
}

async function handleLeadFollowup(job: ScheduledJob) {
  if (!job.lead_id) throw new Error(`${job.job_type}: missing lead_id`);
  const supabase = getSupabaseAdminClient();

  // Gate: only send if the lead is still in 'sent' state (no reply / click
  // / booking). Any other state means no follow-up needed.
  const { data: lead } = await supabase
    .from("leads")
    .select("status, email_clicked_at, template_id, template_variant")
    .eq("id", job.lead_id)
    .maybeSingle();

  if (!lead) throw new Error(`${job.job_type}: lead not found`);
  if (lead.status !== "sent") {
    console.info(`${job.job_type}: skipping, lead status is ${lead.status}`, { leadId: job.lead_id });
    return;
  }

  // Load contact + vehicle for rendering
  const { data: contact } = job.contact_id
    ? await supabase.from("contacts").select("first_name, email, phone").eq("id", job.contact_id).maybeSingle()
    : { data: null };

  // Defensive: if attribution failed (customer booked with different email)
  // but this same email OR phone has a recent confirmed booking for this shop,
  // skip the follow-up. Looks beyond contact_id, which is the only match key
  // the booking intake currently uses.
  if (await contactHasRecentBooking(job, contact, (lead.template_id as string | null) ?? null)) {
    return;
  }

  const { data: leadWithVehicle } = await supabase
    .from("leads")
    .select("vehicle_id, vehicles(make, model)")
    .eq("id", job.lead_id)
    .maybeSingle();

  const vehicle = (leadWithVehicle?.vehicles as unknown as { make: string | null; model: string | null } | null) ?? null;

  const firstName = contact?.first_name ?? "there";
  const email = contact?.email;
  if (!email) throw new Error(`${job.job_type}: contact has no email`);

  const templateKey = job.job_type as TemplateKey;
  const ctx = buildTemplateContext(
    templateKey,
    firstName,
    vehicle?.make ?? "",
    vehicle?.model ?? "",
    null,
    new Map() // no pricing needed for follow-ups
  );
  const rendered = await loadAndRenderTemplate(job.shop_id, templateKey, ctx);

  // Use the existing send helper — writes email_messages, posts to Postmark
  await sendEstimateEmail({
    to: email,
    subject: rendered.subject,
    textBody: rendered.textBody,
    htmlBody: rendered.htmlBody,
    shopId: job.shop_id,
    leadId: job.lead_id,
    contactId: job.contact_id,
    templateId: rendered.templateId,
    templateKey: rendered.templateKey,
    templateVariant: rendered.variant,
  });
}

