/**
 * "Join the Collective" membership config + helpers.
 *
 * One tier, priced by vehicle size (never shown as a matrix - the
 * customer only ever sees their own number). Monthly fee accrues
 * BONUS credit: pay the fee, receive the full quarterly-Deluxe-
 * equivalent credit (~11% bonus). Credit lands in credit_ledger and
 * never expires.
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

/** Ex-GST, in cents. Round-number fees ($100/110/120/130); credit set
 *  so every tier delivers a 15-20% bonus on the fee. */
export const MEMBERSHIP_PRICING: Record<string, { feeCents: number; creditCents: number }> = {
  "Coupe / Hatchback": { feeCents: 10000, creditCents: 12000 },
  "Sedan / Wagon": { feeCents: 11000, creditCents: 13000 },
  "Small / Medium SUV": { feeCents: 12000, creditCents: 14000 },
  "Large SUV / Ute": { feeCents: 13000, creditCents: 15000 },
};

export const DEFAULT_TIER = "Sedan / Wagon";

export function pricingForSize(size: string | null | undefined) {
  return MEMBERSHIP_PRICING[size ?? ""] ?? MEMBERSHIP_PRICING[DEFAULT_TIER];
}

export const MEMBER_PERKS = [
  "Up to 20% bonus credit every month - never expires, spend it on any service",
  "Free mobile service + valet pickup & drop-off (members only)",
  "Priority booking - first pick of the calendar + extended hours",
  "Pro photos of every detail in your account",
];

export type MembershipRecord = {
  id: string;
  contact_id: string;
  shop_id: string;
  vehicle_id: string | null;
  size_tier: string;
  monthly_fee_cents: number;
  monthly_credit_cents: number;
  status: "pending" | "active" | "past_due" | "cancelled";
  started_at: string | null;
  last_accrued_at: string | null;
};

/** Non-cancelled memberships for a set of contact ids. */
export async function getMemberships(contactIds: string[]): Promise<MembershipRecord[]> {
  if (contactIds.length === 0) return [];
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from("memberships")
    .select("id, contact_id, shop_id, vehicle_id, size_tier, monthly_fee_cents, monthly_credit_cents, status, started_at, last_accrued_at")
    .in("contact_id", contactIds)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });
  return (data ?? []) as MembershipRecord[];
}

/** True when any contact id has an ACTIVE membership (perk gating). */
export async function hasActiveMembership(contactIds: string[]): Promise<boolean> {
  const rows = await getMemberships(contactIds);
  return rows.some((m) => m.status === "active");
}

/**
 * Accrue one month of credit for an active membership. Idempotence is
 * the caller's job (Stripe invoice.paid webhook passes the invoice id
 * as the ledger reason so re-delivered webhooks can be detected).
 */
export async function accrueMonthlyCredit(membership: MembershipRecord, reason: string) {
  const supabase = getSupabaseAdminClient();
  const { data: existing } = await supabase
    .from("credit_ledger")
    .select("id")
    .eq("contact_id", membership.contact_id)
    .eq("reason", reason)
    .maybeSingle();
  if (existing) return; // webhook replay - already accrued

  await supabase.from("credit_ledger").insert({
    contact_id: membership.contact_id,
    shop_id: membership.shop_id,
    delta_cents: membership.monthly_credit_cents,
    reason,
    created_by: "collective-membership",
  });
  await supabase
    .from("memberships")
    .update({ last_accrued_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", membership.id);
}
