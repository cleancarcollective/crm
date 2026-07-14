/**
 * Portal data loader - everything the customer dashboard needs in one
 * shape, aggregated across every shop where the session email has a
 * contact record.
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getMemberships, type MembershipRecord } from "@/lib/portal/membership";
import { getPortalContacts, type PortalContact } from "@/lib/portal/session";

export type PortalShop = { id: string; slug: string; name: string; timezone: string };

export type PortalVehicle = {
  id: string;
  shop_id: string;
  contact_id: string;
  make: string | null;
  model: string | null;
  year: string | null;
  rego: string | null;
  size: string | null;
};

export type PortalBooking = {
  id: string;
  shop_id: string;
  contact_id: string;
  vehicle_id: string | null;
  service_name: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string | null;
  duration_minutes: number | null;
  price_estimate: number | null;
  location_type: string | null;
  service_address: string | null;
  notes: string | null;
  series_id: string | null;
};

export type PortalReminder = {
  id: string;
  contact_id: string;
  shop_id: string;
  vehicle_id: string | null;
  cadence_months: number;
  next_due_at: string;
  service_name: string | null;
  status: string;
};

export type PortalPhoto = {
  id: string;
  booking_id: string;
  public_url: string;
  created_at: string;
};

export type PortalStats = {
  /** All-time non-cancelled bookings. */
  lifetimeDetails: number;
  /** ex-GST cents across those bookings. */
  lifetimeSpendCents: number;
  /** Bonus portion of accrued membership credit (the 15%). */
  memberBonusCents: number;
};

export type PortalSnapshot = {
  email: string;
  contacts: PortalContact[];
  shops: PortalShop[];
  vehicles: PortalVehicle[];
  upcomingBookings: PortalBooking[];
  pastBookings: PortalBooking[];
  photos: PortalPhoto[];
  stats: PortalStats;
  reminders: PortalReminder[];
  /** cents, per shop_id */
  creditByShop: Record<string, number>;
  memberships: MembershipRecord[];
  firstName: string | null;
  /** Slug of the customer's "home" shop - the shop of their most recent
   *  booking, falling back to the first contact row. Drives which
   *  city's booking form the portal links to. */
  primaryShopSlug: string;
};

export async function loadPortalSnapshot(email: string): Promise<PortalSnapshot | null> {
  const contacts = await getPortalContacts(email);
  if (contacts.length === 0) return null;

  const supabase = getSupabaseAdminClient();
  const contactIds = contacts.map((c) => c.id);
  const shopIds = [...new Set(contacts.map((c) => c.shop_id))];

  const [shopsRes, vehiclesRes, bookingsRes, remindersRes, creditsRes] = await Promise.all([
    supabase.from("shops").select("id, slug, name, timezone").in("id", shopIds),
    supabase
      .from("vehicles")
      .select("id, shop_id, contact_id, make, model, year, rego, size")
      .in("contact_id", contactIds),
    supabase
      .from("bookings")
      .select(
        "id, shop_id, contact_id, vehicle_id, service_name, status, scheduled_start, scheduled_end, duration_minutes, price_estimate, location_type, service_address, notes, series_id"
      )
      .in("contact_id", contactIds)
      .neq("status", "cancelled")
      .order("scheduled_start", { ascending: false })
      .limit(60),
    supabase
      .from("portal_reminders")
      .select("id, contact_id, shop_id, vehicle_id, cadence_months, next_due_at, service_name, status")
      .in("contact_id", contactIds)
      .neq("status", "cancelled")
      .order("next_due_at", { ascending: true }),
    supabase.from("credit_ledger").select("shop_id, delta_cents").in("contact_id", contactIds),
  ]);
  const memberships = await getMemberships(contactIds);
  const { data: photoRows } = await supabase
    .from("detail_photos")
    .select("id, booking_id, public_url, created_at")
    .in("contact_id", contactIds)
    .order("created_at", { ascending: false })
    .limit(60);

  // Lifetime stats (the "you've invested / saved" tiles). Aggregated
  // over ALL bookings, not just the capped lists below.
  const { data: statRows } = await supabase
    .from("bookings")
    .select("price_estimate, status")
    .in("contact_id", contactIds)
    .neq("status", "cancelled")
    .lte("scheduled_start", nowIsoForStats());
  const lifetimeDetails = statRows?.length ?? 0;
  const lifetimeSpendCents = Math.round(
    (statRows ?? []).reduce((sum, b) => sum + (Number(b.price_estimate) || 0), 0) * 100
  );
  const { data: bonusRows } = await supabase
    .from("credit_ledger")
    .select("delta_cents")
    .in("contact_id", contactIds)
    .eq("created_by", "collective-membership")
    .gt("delta_cents", 0);
  const accrued = (bonusRows ?? []).reduce((s, r) => s + (r.delta_cents ?? 0), 0);
  // Bonus portion of accrued credit: credit = fee x 1.15ish, so the
  // free slice is accrued x (0.15 / 1.15).
  const memberBonusCents = Math.round(accrued * (0.15 / 1.15));

  const nowIso = new Date().toISOString();
  const bookings = (bookingsRes.data ?? []) as PortalBooking[];
  const upcoming = bookings
    .filter((b) => b.scheduled_start >= nowIso)
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
  const past = bookings.filter((b) => b.scheduled_start < nowIso).slice(0, 12);

  const creditByShop: Record<string, number> = {};
  for (const row of creditsRes.data ?? []) {
    creditByShop[row.shop_id] = (creditByShop[row.shop_id] ?? 0) + (row.delta_cents ?? 0);
  }

  const shops = (shopsRes.data ?? []) as PortalShop[];

  // Home shop = shop of the most recent booking (bookings are sorted
  // scheduled_start DESC, so bookings[0] is the latest overall);
  // customers with no bookings fall back to their first contact's shop.
  const latestBookingShopId = bookings[0]?.shop_id ?? null;
  const primaryShopId = latestBookingShopId ?? contacts[0].shop_id;
  const primaryShopSlug = shops.find((s) => s.id === primaryShopId)?.slug ?? shops[0]?.slug ?? "wellington";

  return {
    email,
    contacts,
    shops,
    vehicles: (vehiclesRes.data ?? []) as PortalVehicle[],
    upcomingBookings: upcoming,
    pastBookings: past,
    photos: (photoRows ?? []) as PortalPhoto[],
    stats: { lifetimeDetails, lifetimeSpendCents, memberBonusCents },
    reminders: (remindersRes.data ?? []) as PortalReminder[],
    creditByShop,
    memberships,
    firstName: contacts.find((c) => c.first_name)?.first_name ?? null,
    primaryShopSlug,
  };
}

function nowIsoForStats() {
  return new Date().toISOString();
}

/** True when the given contact id belongs to the session email. */
export async function contactBelongsToEmail(email: string, contactId: string): Promise<boolean> {
  const contacts = await getPortalContacts(email);
  return contacts.some((c) => c.id === contactId);
}
