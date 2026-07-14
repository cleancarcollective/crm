/**
 * Ceramic-coating warranty helpers: auto-creation from completed
 * bookings, 6-monthly maintenance-wash scheduling, and the portal
 * read model.
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type CoatingWarranty = {
  id: string;
  booking_id: string | null;
  contact_id: string;
  shop_id: string;
  vehicle_id: string | null;
  coating_name: string;
  tier: "bronze" | "silver" | "gold" | "unknown";
  applied_at: string;
  expires_at: string | null;
  washes_included: number;
  washes_used: number;
  next_wash_due_at: string | null;
  status: "active" | "expired" | "void";
};

export const TIER_TERM_MONTHS: Record<string, number | null> = {
  bronze: 12,
  silver: 36,
  gold: 60,
  unknown: null,
};

export function detectTier(name: string): CoatingWarranty["tier"] {
  const s = name.toLowerCase();
  if (s.includes("gold")) return "gold";
  if (s.includes("silver") || s.includes("3 year")) return "silver";
  if (s.includes("bronze")) return "bronze";
  return "unknown";
}

export function isPaintCoatingService(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.includes("consultation")) return false;
  return /ceramic coating/i.test(name) || /(gold|silver|bronze).*ceramic/i.test(name) || /ceramic.*(gold|silver|bronze)/i.test(name);
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function nextFutureAnniversary(appliedAt: Date, stepMonths: number): Date {
  let next = addMonths(appliedAt, stepMonths);
  while (next.getTime() < Date.now()) next = addMonths(next, stepMonths);
  return next;
}

export async function getWarranties(contactIds: string[]): Promise<CoatingWarranty[]> {
  if (contactIds.length === 0) return [];
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from("coating_warranties")
    .select("id, booking_id, contact_id, shop_id, vehicle_id, coating_name, tier, applied_at, expires_at, washes_included, washes_used, next_wash_due_at, status")
    .in("contact_id", contactIds)
    .neq("status", "void")
    .order("applied_at", { ascending: false });
  return (data ?? []) as CoatingWarranty[];
}

/**
 * Create warranties for ceramic bookings that have passed but have no
 * warranty row yet (new jobs completing after the backfill). Called
 * from the daily cron; idempotent via the unique booking_id index.
 */
export async function createWarrantiesForNewCoatings(): Promise<number> {
  const supabase = getSupabaseAdminClient();
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, shop_id, contact_id, vehicle_id, service_name, status, scheduled_start")
    .ilike("service_name", "%ceramic%")
    .neq("status", "cancelled")
    .gte("scheduled_start", since)
    .lte("scheduled_start", new Date().toISOString());

  let created = 0;
  for (const b of bookings ?? []) {
    if (!b.contact_id || !isPaintCoatingService(b.service_name ?? "")) continue;
    const tier = detectTier(b.service_name ?? "");
    const applied = new Date(b.scheduled_start);
    const term = TIER_TERM_MONTHS[tier];
    const { error } = await supabase.from("coating_warranties").insert({
      booking_id: b.id,
      contact_id: b.contact_id,
      shop_id: b.shop_id,
      vehicle_id: b.vehicle_id,
      coating_name: b.service_name,
      tier,
      applied_at: applied.toISOString(),
      expires_at: term ? addMonths(applied, term).toISOString() : null,
      washes_included: 3,
      washes_used: 0,
      next_wash_due_at: nextFutureAnniversary(applied, 6).toISOString(),
      status: "active",
      notes: "Auto-created on job completion",
    });
    if (!error) created += 1;
    // 23505 = already exists, anything else logged by caller context.
  }
  return created;
}
