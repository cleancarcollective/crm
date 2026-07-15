/**
 * Customer journey touchpoint registry + stats loader for /journey.
 *
 * The registry is the source of truth for WHICH automated customer-facing
 * emails/SMS exist along the journey. It is intentionally static and lives
 * next to the code that sends them — if you add a new touchpoint, add it
 * here so it shows up on the journey page.
 *
 * Stats come from scheduled_email_jobs / scheduled_sms_jobs / email_messages
 * at render time. Touchpoints that send immediately (not via a job table)
 * are matched through email_messages.template_id → email_templates.key;
 * inline-HTML senders with no template row are marked "untracked".
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type Channel = "email" | "sms";

export type TouchpointStatKey =
  // scheduled_email_jobs.job_type
  | { kind: "email_job_type"; value: string }
  // scheduled_email_jobs.template_key
  | { kind: "email_job_template"; value: string }
  // email_messages joined to email_templates.key (direct sends)
  | { kind: "email_message_template"; value: string }
  // scheduled_sms_jobs.template_key
  | { kind: "sms_template"; value: string }
  // legacy untagged SMS rows, split heuristically
  | { kind: "sms_legacy"; value: "booking_reminder" | "lead_followup" | "review_request" }
  // sender doesn't record per-message rows we can attribute
  | { kind: "untracked" };

export type Touchpoint = {
  id: string;
  label: string;
  channel: Channel;
  /** What causes it to send. */
  trigger: string;
  /** When it sends relative to the trigger. */
  timing: string;
  /** Static or env-derived enabled state, resolved at render time. */
  enabled: boolean;
  /** Why it's off / anything the reader must know. */
  note?: string;
  stat: TouchpointStatKey;
};

export type Stage = {
  id: string;
  title: string;
  subtitle: string;
  touchpoints: Touchpoint[];
};

export function buildJourneyStages(): Stage[] {
  const followupsOn = process.env.LEAD_FOLLOWUPS_ENABLED === "true";
  return [
    {
      id: "lead",
      title: "1 · Lead captured",
      subtitle: "Estimate form submitted on the website",
      touchpoints: [
        {
          id: "lead_auto_estimate",
          label: "Auto estimate reply",
          channel: "email",
          trigger: "New lead passes auto-respond checks",
          timing: "Within minutes",
          enabled: true,
          stat: { kind: "email_job_type", value: "lead_auto_estimate" },
        },
        {
          id: "lead_confirmation",
          label: "Enquiry received acknowledgement",
          channel: "email",
          trigger: "New lead (any)",
          timing: "Immediate",
          enabled: false,
          note: "Intentionally disabled in the intake route — auto estimate covers it.",
          stat: { kind: "untracked" },
        },
      ],
    },
    {
      id: "nurture",
      title: "2 · Lead nurture",
      subtitle: "Lead has an estimate but hasn't booked",
      touchpoints: [
        {
          id: "lead_followup_3day",
          label: "3-day follow-up",
          channel: "email",
          trigger: "Estimate sent, no booking",
          timing: "T+3 days",
          enabled: followupsOn,
          note: followupsOn ? undefined : "Killed 28 May 2026 (LEAD_FOLLOWUPS_ENABLED). Old copy was pushy.",
          stat: { kind: "email_job_type", value: "lead_followup_3day" },
        },
        {
          id: "lead_followup_5day_sms",
          label: "5-day follow-up",
          channel: "sms",
          trigger: "Estimate sent, no booking",
          timing: "T+5 days",
          enabled: followupsOn,
          note: followupsOn ? undefined : "Same kill switch as email follow-ups.",
          stat: { kind: "sms_legacy", value: "lead_followup" },
        },
        {
          id: "lead_followup_7day",
          label: "7-day follow-up",
          channel: "email",
          trigger: "Estimate sent, no booking",
          timing: "T+7 days",
          enabled: followupsOn,
          note: followupsOn ? undefined : "Same kill switch.",
          stat: { kind: "email_job_type", value: "lead_followup_7day" },
        },
        {
          id: "lead_followup_30day",
          label: "30-day win-back",
          channel: "email",
          trigger: "Estimate sent, no booking",
          timing: "T+30 days",
          enabled: followupsOn,
          note: "Never fired even before the kill switch — system launched April, switch flipped May.",
          stat: { kind: "email_job_type", value: "lead_followup_30day" },
        },
      ],
    },
    {
      id: "booked",
      title: "3 · Booking confirmed",
      subtitle: "Customer books (website or staff)",
      touchpoints: [
        {
          id: "booking_confirmation_email",
          label: "Booking confirmation",
          channel: "email",
          trigger: "Booking created",
          timing: "Immediate",
          enabled: true,
          stat: { kind: "email_message_template", value: "booking-confirmation" },
        },
        {
          id: "booking_confirmation_sms",
          label: "Booking confirmation",
          channel: "sms",
          trigger: "Booking created",
          timing: "Immediate",
          enabled: true,
          note: "Sent directly via TNZ — per-send rows aren't recorded.",
          stat: { kind: "untracked" },
        },
      ],
    },
    {
      id: "preservice",
      title: "4 · Pre-service reminders",
      subtitle: "Countdown to the appointment",
      touchpoints: [
        {
          id: "reminder_week",
          label: "1 week before",
          channel: "email",
          trigger: "Upcoming booking",
          timing: "T-7 days",
          enabled: true,
          stat: { kind: "email_job_template", value: "booking-reminder-week" },
        },
        {
          id: "reminder_day",
          label: "1 day before",
          channel: "email",
          trigger: "Upcoming booking",
          timing: "T-1 day",
          enabled: true,
          stat: { kind: "email_job_template", value: "booking-reminder-day" },
        },
        {
          id: "reminder_day_sms",
          label: "1 day before",
          channel: "sms",
          trigger: "Upcoming booking",
          timing: "T-1 day",
          enabled: true,
          stat: { kind: "sms_template", value: "booking_reminder_day" },
        },
        {
          id: "reminder_hour",
          label: "1 hour before",
          channel: "email",
          trigger: "Upcoming booking",
          timing: "T-1 hour",
          enabled: true,
          stat: { kind: "email_job_template", value: "booking-reminder-hour" },
        },
      ],
    },
    {
      id: "pickup",
      title: "5 · Service done",
      subtitle: "Vehicle ready + follow-through",
      touchpoints: [
        {
          id: "pickup_ready_email",
          label: "Pickup ready",
          channel: "email",
          trigger: "Staff mark vehicle ready",
          timing: "Immediate",
          enabled: true,
          note: "Direct send — per-send rows aren't recorded.",
          stat: { kind: "untracked" },
        },
        {
          id: "pickup_ready_sms",
          label: "Pickup ready",
          channel: "sms",
          trigger: "Staff mark vehicle ready",
          timing: "Immediate",
          enabled: true,
          note: "Direct send via TNZ.",
          stat: { kind: "untracked" },
        },
        {
          id: "review_request_sms",
          label: "Review request",
          channel: "sms",
          trigger: "Booking completed (pickup)",
          timing: "T+23 hours",
          enabled: true,
          note: "FIXED 2 Jul 2026 — every review SMS before this date was auto-cancelled by a booking-status guard (\"Booking already completed\"). Zero were ever delivered.",
          stat: { kind: "sms_template", value: "review_request" },
        },
      ],
    },
    {
      id: "upsell",
      title: "6 · The Collective upsell",
      subtitle: "4-touch email drip after a completed detail — invites them to join the Collective (recurring detailing, 15% off) at /account",
      touchpoints: [
        {
          id: "drip_next_day",
          label: "Next-day Collective invite",
          channel: "email",
          trigger: "Detail completed",
          timing: "T+1 day, 9am",
          enabled: true,
          stat: { kind: "email_job_template", value: "post_detail_recurring_offer_next_day" },
        },
        {
          id: "drip_next_day_sms",
          label: "Next-day offer",
          channel: "sms",
          trigger: "Detail completed",
          timing: "T+1 day, 9am",
          enabled: true,
          stat: { kind: "sms_template", value: "post_detail_recurring_offer_next_day" },
        },
        {
          id: "drip_6w",
          label: "6-week Collective invite",
          channel: "email",
          trigger: "Detail completed",
          timing: "T+42 days, 11am",
          enabled: true,
          stat: { kind: "email_job_template", value: "post_detail_recurring_offer_6w" },
        },
        {
          id: "drip_6w_sms",
          label: "6-week offer",
          channel: "sms",
          trigger: "Detail completed",
          timing: "T+42 days, 11am",
          enabled: true,
          stat: { kind: "sms_template", value: "post_detail_recurring_offer_6w" },
        },
        {
          id: "drip_10w",
          label: "10-week Collective invite",
          channel: "email",
          trigger: "Detail completed",
          timing: "T+70 days, 11am",
          enabled: true,
          stat: { kind: "email_job_template", value: "post_detail_recurring_offer_10w" },
        },
        {
          id: "drip_10w_sms",
          label: "10-week offer",
          channel: "sms",
          trigger: "Detail completed",
          timing: "T+70 days, 11am",
          enabled: true,
          stat: { kind: "sms_template", value: "post_detail_recurring_offer_10w" },
        },
        {
          id: "drip_16w",
          label: "16-week Collective invite",
          channel: "email",
          trigger: "Detail completed",
          timing: "T+112 days, 11am",
          enabled: true,
          stat: { kind: "email_job_template", value: "post_detail_recurring_offer_16w" },
        },
        {
          id: "drip_16w_sms",
          label: "16-week offer",
          channel: "sms",
          trigger: "Detail completed",
          timing: "T+112 days, 11am",
          enabled: true,
          stat: { kind: "sms_template", value: "post_detail_recurring_offer_16w" },
        },
      ],
    },
    {
      id: "recurring",
      title: "7 · Recurring customer",
      subtitle: "Customer on a recurring series",
      touchpoints: [
        {
          id: "series_confirmation",
          label: "Series confirmation",
          channel: "email",
          trigger: "Recurring series created",
          timing: "Immediate",
          enabled: true,
          note: "Direct send — per-send rows aren't recorded. Occurrence reminders reuse stage 4.",
          stat: { kind: "untracked" },
        },
        {
          id: "series_cancel",
          label: "Series cancelled notice",
          channel: "email",
          trigger: "Staff cancel a series",
          timing: "Immediate",
          enabled: true,
          note: "Direct send.",
          stat: { kind: "untracked" },
        },
      ],
    },
  ];
}

// ── Stats ──────────────────────────────────────────────────────────────────

export type TouchpointStats = {
  sent: number;
  sentLast30: number;
  pending: number;
  cancelled: number;
  failed: number;
  lastSentAt: string | null;
  nextScheduledAt: string | null;
  tracked: boolean;
};

export type JourneyData = {
  stats: Record<string, TouchpointStats>;
  conversions: {
    lockInRedemptions: number;
    seriesFromDrip: number;
    seriesTotal: number;
  };
};

const EMPTY: TouchpointStats = {
  sent: 0, sentLast30: 0, pending: 0, cancelled: 0, failed: 0,
  lastSentAt: null, nextScheduledAt: null, tracked: true,
};

type JobRow = {
  job_type?: string | null;
  template_key: string | null;
  status: string;
  created_at: string;
  scheduled_for: string | null;
  sent_at?: string | null;
  lead_id?: string | null;
  booking_id?: string | null;
  message?: string | null;
};

function classifyLegacySms(row: JobRow): "booking_reminder" | "lead_followup" | "review_request" | null {
  if (row.template_key) return null;
  if (row.lead_id) return "lead_followup";
  const msg = (row.message ?? "").toLowerCase();
  if (msg.includes("feedback") || msg.includes("review")) return "review_request";
  if (row.booking_id) return "booking_reminder";
  return null;
}

function accumulate(stats: TouchpointStats, row: JobRow, now: Date) {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000).toISOString();
  if (row.status === "sent") {
    stats.sent += 1;
    const at = row.sent_at ?? row.scheduled_for ?? row.created_at;
    if (at >= thirtyDaysAgo) stats.sentLast30 += 1;
    if (!stats.lastSentAt || at > stats.lastSentAt) stats.lastSentAt = at;
  } else if (row.status === "pending" || row.status === "processing") {
    stats.pending += 1;
    if (row.scheduled_for && (!stats.nextScheduledAt || row.scheduled_for < stats.nextScheduledAt)) {
      if (row.scheduled_for >= now.toISOString()) stats.nextScheduledAt = row.scheduled_for;
    }
  } else if (row.status === "cancelled" || row.status === "skipped") {
    stats.cancelled += 1;
  } else if (row.status === "failed") {
    stats.failed += 1;
  }
}

export async function loadJourneyData(shopId: string): Promise<JourneyData> {
  const supabase = getSupabaseAdminClient();
  const now = new Date();

  const [emailJobs, smsJobs, templates, messages, redemptions, series] = await Promise.all([
    supabase
      .from("scheduled_email_jobs")
      .select("job_type, template_key, status, created_at, scheduled_for")
      .eq("shop_id", shopId)
      .limit(20000),
    supabase
      .from("scheduled_sms_jobs")
      .select("template_key, status, created_at, scheduled_for, sent_at, lead_id, booking_id, message")
      .eq("shop_id", shopId)
      .limit(20000),
    supabase.from("email_templates").select("id, key").eq("shop_id", shopId),
    supabase
      .from("email_messages")
      .select("template_id, status, created_at, sent_at")
      .eq("shop_id", shopId)
      .not("template_id", "is", null)
      .limit(20000),
    supabase
      .from("consumed_action_tokens")
      .select("token", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("action", "lock_in_recurring"),
    supabase.from("booking_series").select("series_source").eq("shop_id", shopId),
  ]);

  const templateKeyById = new Map<string, string>();
  for (const t of templates.data ?? []) templateKeyById.set(t.id as string, t.key as string);

  const stats: Record<string, TouchpointStats> = {};
  const get = (key: string): TouchpointStats => (stats[key] ??= { ...EMPTY });

  for (const row of (emailJobs.data ?? []) as JobRow[]) {
    if (row.job_type) accumulate(get(`email_job_type:${row.job_type}`), row, now);
    if (row.template_key) accumulate(get(`email_job_template:${row.template_key}`), row, now);
  }

  for (const row of (smsJobs.data ?? []) as JobRow[]) {
    if (row.template_key) {
      accumulate(get(`sms_template:${row.template_key}`), row, now);
    } else {
      // Rows created before template_key was recorded (pre Jul 2026).
      const legacy = classifyLegacySms(row);
      if (legacy === "booking_reminder") accumulate(get("sms_template:booking_reminder_day"), row, now);
      else if (legacy === "review_request") accumulate(get("sms_template:review_request"), row, now);
      else if (legacy === "lead_followup") accumulate(get("sms_legacy:lead_followup"), row, now);
    }
  }

  for (const row of messages.data ?? []) {
    const key = templateKeyById.get(row.template_id as string);
    if (!key) continue;
    accumulate(
      get(`email_message_template:${key}`),
      { template_key: key, status: row.status as string, created_at: row.created_at as string, scheduled_for: null, sent_at: row.sent_at as string | null },
      now
    );
  }

  const seriesRows = series.data ?? [];
  return {
    stats,
    conversions: {
      lockInRedemptions: redemptions.count ?? 0,
      seriesFromDrip: seriesRows.filter((s) => s.series_source === "post_detail_offer").length,
      seriesTotal: seriesRows.length,
    },
  };
}

export function statKeyToString(stat: TouchpointStatKey): string | null {
  if (stat.kind === "untracked") return null;
  return `${stat.kind}:${stat.value}`;
}
