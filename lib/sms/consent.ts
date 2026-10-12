/**
 * SMS marketing consent.
 *
 * Two kinds of text leave this system:
 *   - TRANSACTIONAL: tied to a booking the customer made themselves
 *     (confirmation, day-before reminder, "car is ready", review request,
 *     mid-detail upsell offer). These keep sending after an opt-out, the
 *     same way a courier still texts you a delivery window.
 *   - MARKETING: unsolicited offers (post-detail recurring-plan drips, lead
 *     nurture follow-ups). These MUST stop the moment a customer opts out.
 *
 * Source of truth is contacts.sms_opt_out (see
 * docs/migrations/2026-10-12-contacts-sms-opt-out.sql). Until that column
 * exists in prod, OPT_OUT_CONTACT_IDS below is the fallback register so an
 * opt-out is honoured on the very next cron run regardless of schema state.
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

/** Template keys that are marketing, not transactional. */
export const MARKETING_SMS_TEMPLATE_KEYS: ReadonlySet<string> = new Set([
  "post_detail_recurring_offer_next_day",
  "post_detail_recurring_offer_6w",
  "post_detail_recurring_offer_10w",
  "post_detail_recurring_offer_16w",
  "lead_followup",
  "ad_nurture_day1",
  "ad_nurture_day3",
  "ad_nurture_day6",
]);

export function isMarketingSmsTemplate(templateKey: string | null | undefined): boolean {
  if (!templateKey) return false;
  if (MARKETING_SMS_TEMPLATE_KEYS.has(templateKey)) return true;
  // Belt and braces: any future "offer" / "nurture" style key is marketing.
  return /offer|nurture|promo|winback|re-?engage/i.test(templateKey);
}

/**
 * Fallback register. Contacts who have opted out but whose row cannot yet
 * carry the flag (column not migrated). Remove entries once the column is
 * live and the flag is set on the row.
 *
 * - f45b4640-288a-4a09-ae6a-b1bc82636417  Amy Bendall (WLG), email 10 Oct 2026:
 *   "Please take me off the texting list"
 */
const OPT_OUT_CONTACT_IDS: ReadonlySet<string> = new Set([
  "f45b4640-288a-4a09-ae6a-b1bc82636417",
]);

/**
 * Has this contact opted out of marketing SMS? Reads the DB flag when the
 * column exists, and always honours the fallback register. Never throws:
 * a consent lookup failing must not block a send pipeline, so on error we
 * fall back to the register only.
 */
export async function hasSmsOptOut(contactId: string | null | undefined): Promise<boolean> {
  if (!contactId) return false;
  if (OPT_OUT_CONTACT_IDS.has(contactId)) return true;
  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("contacts")
      .select("sms_opt_out")
      .eq("id", contactId)
      .maybeSingle();
    // 42703 = column doesn't exist yet (pre-migration). Treat as not opted
    // out via DB; the register above still applies.
    if (error) return false;
    return Boolean((data as { sms_opt_out?: boolean } | null)?.sms_opt_out);
  } catch {
    return false;
  }
}

/**
 * Mark a contact as opted out and cancel every pending marketing SMS job
 * for them. Safe to call when the column is missing: the job cancellation
 * still happens, and the error is surfaced so the caller can tell staff
 * the flag itself did not persist.
 */
export async function recordSmsOptOut(
  contactId: string,
  reason: string
): Promise<{ flagSaved: boolean; cancelledJobs: number; error?: string }> {
  const supabase = getSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  // 1. Cancel pending marketing jobs regardless of schema state.
  const { data: pending } = await supabase
    .from("scheduled_sms_jobs")
    .select("id, template_key")
    .eq("contact_id", contactId)
    .eq("status", "pending");
  const toCancel = (pending ?? []).filter((j) =>
    isMarketingSmsTemplate((j as { template_key?: string | null }).template_key)
  );
  if (toCancel.length > 0) {
    await supabase
      .from("scheduled_sms_jobs")
      .update({ status: "cancelled", last_error: `Customer opted out of SMS marketing: ${reason}` })
      .in("id", toCancel.map((j) => j.id as string));
  }

  // 2. Persist the flag.
  const { error } = await supabase
    .from("contacts")
    .update({ sms_opt_out: true, sms_opt_out_at: nowIso, sms_opt_out_reason: reason, updated_at: nowIso })
    .eq("id", contactId);

  return { flagSaved: !error, cancelledJobs: toCancel.length, error: error?.message };
}

export async function clearSmsOptOut(contactId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("contacts")
    .update({ sms_opt_out: false, sms_opt_out_at: null, sms_opt_out_reason: null, updated_at: new Date().toISOString() })
    .eq("id", contactId);
  return { ok: !error, error: error?.message };
}
