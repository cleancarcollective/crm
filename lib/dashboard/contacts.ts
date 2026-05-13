import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type {
  BookingRecord,
  BookingWithRelations,
  ClientDirectoryEntry,
  ContactProfile,
  ContactRecord,
  EmailEventRecord,
  EmailMessageRecord,
  EmailMessageWithEvents,
  LeadDirectoryEntry,
  LeadRecord,
  LeadWithVehicle,
  VehicleRecord,
} from "@/lib/dashboard/types";
import { getShopById, getShopBySlug } from "@/lib/dashboard/bookings";

const OPEN_LEAD_STATUSES = new Set(["new", "contacted", "quoted", "clicked"]);
const OPEN_LEAD_STATUS_LIST = ["new", "contacted", "quoted", "clicked"];

/**
 * Page size for directory pages — shared so the page UI and the data fn
 * can't disagree about how many rows fit per page.
 */
export const DIRECTORY_PAGE_SIZE = 20;

/**
 * Escape a string for safe inclusion inside a PostgREST .or() filter.
 * PostgREST splits on commas and parentheses, so anything user-typed needs
 * to be sanitised. We strip the dangerous chars rather than try to escape —
 * names rarely contain them and we'd rather drop the search than break it.
 */
function escapeForOrFilter(s: string): string {
  return s.replace(/[(),%]/g, " ").trim();
}

export async function getContactProfileById(id: string) {
  const supabase = getSupabaseAdminClient();
  const { data: contact, error } = await supabase
    .from("contacts")
    .select("id, shop_id, first_name, last_name, full_name, email, phone, notes, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!contact) {
    return null;
  }

  const typedContact = contact as ContactRecord;
  const shop = await getShopById(String(typedContact.shop_id));

  const [vehicles, leads, bookings, credits] = await Promise.all([
    getVehiclesForContact(typedContact.id),
    getLeadsForContact(typedContact.id),
    getBookingsForContact(typedContact),
    getCreditsForContact(typedContact.id),
  ]);

  const emails = await getEmailsForContact({
    contactId: typedContact.id,
    leadIds: leads.map((lead) => lead.id),
  });

  return {
    shop,
    contact: typedContact,
    vehicles,
    leads,
    bookings,
    emails,
    credits,
  } satisfies ContactProfile;
}

async function getCreditsForContact(contactId: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("customer_credits")
    .select("*")
    .eq("contact_id", contactId)
    .eq("redeemed", false)
    .order("created_at", { ascending: false });
  if (error) {
    // If the table doesn't exist yet (migration not run) treat as no credits
    if (error.code === "PGRST205" || error.message?.includes("does not exist")) return [];
    throw error;
  }
  return (data ?? []) as import("@/lib/dashboard/types").CustomerCreditRecord[];
}

export async function getLeadDirectory(shopSlug: string) {
  const shop = await getShopBySlug(shopSlug);
  const [contacts, leads] = await Promise.all([
    getContactsForShop(shop.id),
    getLeadsForShop(shop.id),
  ]);

  // Group all leads by contact
  const leadsByContact = new Map<string, LeadWithVehicle[]>();
  for (const lead of leads) {
    if (!lead.contact_id) continue;
    const existing = leadsByContact.get(lead.contact_id) ?? [];
    existing.push(lead);
    leadsByContact.set(lead.contact_id, existing);
  }

  // Build entries for any contact that has at least one lead
  const entries = contacts
    .map((contact) => {
      const contactLeads = leadsByContact.get(contact.id) ?? [];
      if (contactLeads.length === 0) return null;
      // Show most recently updated lead first
      const sorted = [...contactLeads].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return {
        contact,
        latestLead: sorted[0],
        leadCount: contactLeads.length,
      } satisfies LeadDirectoryEntry;
    })
    .filter((entry): entry is LeadDirectoryEntry => entry !== null)
    .sort((a, b) => b.latestLead.updated_at.localeCompare(a.latestLead.updated_at));

  // Conversion stats
  const totalLeads = leads.length;
  const wonLeads = leads.filter((l) => l.status === "won").length;
  const openLeads = leads.filter((l) => OPEN_LEAD_STATUSES.has(l.status)).length;
  const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;

  return { shop, entries, stats: { totalLeads, wonLeads, openLeads, conversionRate } };
}

/**
 * Server-paginated leads directory. Returns just the visible page plus
 * shop-wide stats — no full table dump like getLeadDirectory.
 *
 * Search: matches on contact name/email/phone (a leading two-step query
 * resolves the matching contact_ids first, then filters leads by those).
 * If the search returns no contacts, we short-circuit to an empty result.
 *
 * Pagination: oversamples leads 4× to dedupe by contact (the directory
 * shows 1 row per contact, latest lead). Approximate but stable enough —
 * search/filter is the primary nav once volume is high.
 */
export async function getLeadDirectoryPage(args: {
  shopSlug: string;
  query: string;
  status: string;
  page: number;
  pageSize?: number;
}) {
  const { shopSlug, query: rawQuery, status } = args;
  const pageSize = args.pageSize ?? DIRECTORY_PAGE_SIZE;
  const page = Math.max(1, args.page | 0);

  const shop = await getShopBySlug(shopSlug);
  const supabase = getSupabaseAdminClient();

  const query = escapeForOrFilter(rawQuery);

  // 1. Resolve matching contact ids if there's a search term
  let contactIdFilter: string[] | null = null;
  if (query) {
    const orFilter = [
      `full_name.ilike.%${query}%`,
      `first_name.ilike.%${query}%`,
      `last_name.ilike.%${query}%`,
      `email.ilike.%${query}%`,
      `phone.ilike.%${query}%`,
    ].join(",");
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("shop_id", shop.id)
      .or(orFilter)
      .limit(2000);
    if (error) throw error;
    contactIdFilter = (data ?? []).map((c) => c.id as string);
    if (contactIdFilter.length === 0) {
      return await emptyLeadPage(shop);
    }
  }

  // Page leads + stats in parallel. We oversample to dedupe by contact +
  // detect "has more" — fetching pageSize×4+1 means if we get >pageSize
  // unique contacts AND there's a "+1" hangover, there's another page.
  // No count query — that was the slowest single piece on Wellington.
  const oversample = pageSize * 4 + 1;
  const startRange = (page - 1) * pageSize;
  const inFilter = contactIdFilter ? contactIdFilter.slice(0, IN_BATCH) : null;

  let leadsQuery = supabase
    .from("leads")
    .select("id, shop_id, contact_id, vehicle_id, source, source_detail, service_requested, notes, status, won_source, template_key, suggested_size, confidence, reason_code, approved_size, created_at, updated_at, booked_at")
    .eq("shop_id", shop.id)
    .not("archived", "eq", true)
    .order("updated_at", { ascending: false })
    .range(startRange, startRange + oversample - 1);
  if (status) leadsQuery = leadsQuery.eq("status", status);
  if (inFilter) leadsQuery = leadsQuery.in("contact_id", inFilter);

  const [statsResult, leadsResult] = await Promise.all([getLeadStats(shop.id), leadsQuery]);
  if (leadsResult.error) throw leadsResult.error;
  const stats = statsResult;
  const leads = (leadsResult.data ?? []) as LeadRecord[];

  // Dedupe by contact, take pageSize
  const seen = new Set<string>();
  const uniqueLeads: LeadRecord[] = [];
  for (const l of leads) {
    if (!l.contact_id) continue;
    if (seen.has(l.contact_id)) continue;
    seen.add(l.contact_id);
    uniqueLeads.push(l);
    if (uniqueLeads.length >= pageSize) break;
  }

  // hasMore: if we got more leads than we needed for this page (after
  // dedupe headroom), there's at least one more page worth.
  const hasMore = leads.length >= oversample;
  const totalPages = hasMore ? page + 1 : page;

  // Hydrate contacts + vehicles. Per-contact lead counts dropped from the
  // directory view — they were the slowest hydration query and the count
  // is only meaningful on the contact profile page anyway.
  const contactIds = uniqueLeads.map((l) => l.contact_id as string);
  const vehicleIds = uniqueLeads.map((l) => l.vehicle_id).filter(Boolean) as string[];
  const [contacts, vehicles] = await Promise.all([
    getContactsByIds(contactIds),
    getVehiclesByIds(vehicleIds),
  ]);
  const leadCountByContact = new Map<string, number>();
  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

  const entries: LeadDirectoryEntry[] = uniqueLeads
    .map((lead) => {
      const contact = contactMap.get(lead.contact_id as string);
      if (!contact) return null;
      const latestLead: LeadWithVehicle = {
        ...lead,
        vehicle: lead.vehicle_id ? vehicleMap.get(lead.vehicle_id) ?? null : null,
      };
      return {
        contact,
        latestLead,
        leadCount: leadCountByContact.get(lead.contact_id as string) ?? 1,
      } satisfies LeadDirectoryEntry;
    })
    .filter((e): e is LeadDirectoryEntry => e !== null);

  return { shop, entries, stats, page, totalPages, pageSize };
}

async function emptyLeadPage(shop: { id: string; slug: string; name: string; timezone: string }) {
  const stats = await getLeadStats(shop.id);
  return { shop, entries: [] as LeadDirectoryEntry[], stats, page: 1, totalPages: 1, pageSize: DIRECTORY_PAGE_SIZE };
}

async function getLeadStats(shopId: string) {
  const supabase = getSupabaseAdminClient();
  const baseFilter = (q: any) => q.eq("shop_id", shopId).not("archived", "eq", true);
  const [
    totalRes,
    wonRes,
    openRes,
  ] = await Promise.all([
    baseFilter(supabase.from("leads").select("id", { count: "exact", head: true })),
    baseFilter(supabase.from("leads").select("id", { count: "exact", head: true })).eq("status", "won"),
    baseFilter(supabase.from("leads").select("id", { count: "exact", head: true })).in("status", OPEN_LEAD_STATUS_LIST),
  ]);
  const totalLeads = totalRes.count ?? 0;
  const wonLeads = wonRes.count ?? 0;
  const openLeads = openRes.count ?? 0;
  const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;
  return { totalLeads, wonLeads, openLeads, conversionRate };
}

async function getLeadCountsByContact(contactIds: string[]): Promise<Map<string, number>> {
  if (contactIds.length === 0) return new Map();
  const supabase = getSupabaseAdminClient();
  const counts = new Map<string, number>();
  for (const batch of chunk(contactIds, IN_BATCH)) {
    const { data, error } = await supabase
      .from("leads")
      .select("contact_id")
      .in("contact_id", batch)
      .not("archived", "eq", true);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ contact_id: string | null }>) {
      if (!row.contact_id) continue;
      counts.set(row.contact_id, (counts.get(row.contact_id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Server-paginated clients directory. Same idea as getLeadDirectoryPage:
 * search resolves to contact ids, then we fetch one page of bookings,
 * dedupe by contact (latest booking per contact), hydrate.
 */
export async function getClientDirectoryPage(args: {
  shopSlug: string;
  query: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize?: number;
}) {
  const { shopSlug, query: rawQuery, status, dateFrom, dateTo } = args;
  const pageSize = args.pageSize ?? DIRECTORY_PAGE_SIZE;
  const page = Math.max(1, args.page | 0);

  const shop = await getShopBySlug(shopSlug);
  const supabase = getSupabaseAdminClient();

  const query = escapeForOrFilter(rawQuery);
  const fromIso = dateFrom ? new Date(dateFrom).toISOString() : null;
  const toIso = dateTo ? new Date(dateTo + "T23:59:59").toISOString() : null;

  let contactIdFilter: string[] | null = null;
  if (query) {
    const orFilter = [
      `full_name.ilike.%${query}%`,
      `first_name.ilike.%${query}%`,
      `last_name.ilike.%${query}%`,
      `email.ilike.%${query}%`,
      `phone.ilike.%${query}%`,
    ].join(",");
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("shop_id", shop.id)
      .or(orFilter)
      .limit(2000);
    if (error) throw error;
    contactIdFilter = (data ?? []).map((c) => c.id as string);
    if (contactIdFilter.length === 0) {
      return { shop, entries: [] as ClientDirectoryEntry[], page: 1, totalPages: 1, pageSize, totalRevenue: 0, totalBookings: 0 };
    }
  }

  const oversample = pageSize * 4;
  const startRange = (page - 1) * pageSize;
  const inFilter = contactIdFilter ? contactIdFilter.slice(0, IN_BATCH) : null;

  // Just one query: the page worth of bookings, oversampled. No count, no
  // revenue sum — those were each loading thousands of rows. The summary
  // shows page X (no Y), and revenue lives on the analytics page.
  const oversampleSize = oversample + 1; // +1 to detect "has more"
  let bookingsQuery = supabase
    .from("bookings")
    .select("*")
    .eq("shop_id", shop.id)
    .order("scheduled_start", { ascending: false })
    .range(startRange, startRange + oversampleSize - 1);
  if (status) bookingsQuery = bookingsQuery.eq("status", status);
  if (fromIso) bookingsQuery = bookingsQuery.gte("scheduled_start", fromIso);
  if (toIso) bookingsQuery = bookingsQuery.lte("scheduled_start", toIso);
  if (inFilter) bookingsQuery = bookingsQuery.in("contact_id", inFilter);

  const { data: rawBookings, error: bookingsErr } = await bookingsQuery;
  if (bookingsErr) throw bookingsErr;
  const bookings = (rawBookings ?? []) as BookingRecord[];

  // Dedupe by contact
  const seen = new Set<string>();
  const uniqueBookings: BookingRecord[] = [];
  for (const b of bookings) {
    if (!b.contact_id) continue;
    if (seen.has(b.contact_id)) continue;
    seen.add(b.contact_id);
    uniqueBookings.push(b);
    if (uniqueBookings.length >= pageSize) break;
  }

  // hasMore detection from oversample fetch
  const hasMore = bookings.length >= oversampleSize;
  const totalPages = hasMore ? page + 1 : page;
  const totalRevenue = 0; // surfaced on analytics page now, not directory
  const totalMatchingBookings = uniqueBookings.length + (hasMore ? 1 : 0);

  // Hydrate just contacts + vehicles for the visible page. Per-contact
  // booking-count and revenue queries were the bottleneck — drop them
  // from the list view (the contact profile already shows total bookings
  // + total revenue).
  const contactIds = uniqueBookings.map((b) => b.contact_id as string);
  const vehicleIds = uniqueBookings.map((b) => b.vehicle_id).filter(Boolean) as string[];
  const [contacts, vehicles] = await Promise.all([
    getContactsByIds(contactIds),
    getVehiclesByIds(vehicleIds),
  ]);
  const bookingCountByContact = new Map<string, number>();
  const revenueByContact = new Map<string, number>();
  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

  const entries: ClientDirectoryEntry[] = uniqueBookings
    .map((booking) => {
      const contact = contactMap.get(booking.contact_id as string);
      if (!contact) return null;
      const latestBooking: BookingWithRelations = {
        ...booking,
        contact: contact ?? null,
        vehicle: booking.vehicle_id ? vehicleMap.get(booking.vehicle_id) ?? null : null,
      };
      return {
        contact,
        latestBooking,
        bookingCount: bookingCountByContact.get(booking.contact_id as string) ?? 1,
        totalRevenue: revenueByContact.get(booking.contact_id as string) ?? (booking.price_estimate ?? 0),
      } satisfies ClientDirectoryEntry;
    })
    .filter((e): e is ClientDirectoryEntry => e !== null);

  return {
    shop,
    entries,
    page,
    totalPages,
    pageSize,
    totalRevenue,
    totalBookings: totalMatchingBookings ?? 0,
  };
}

async function getBookingCountsByContact(contactIds: string[]): Promise<Map<string, number>> {
  if (contactIds.length === 0) return new Map();
  const supabase = getSupabaseAdminClient();
  const counts = new Map<string, number>();
  for (const batch of chunk(contactIds, IN_BATCH)) {
    const { data, error } = await supabase.from("bookings").select("contact_id").in("contact_id", batch);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ contact_id: string | null }>) {
      if (!row.contact_id) continue;
      counts.set(row.contact_id, (counts.get(row.contact_id) ?? 0) + 1);
    }
  }
  return counts;
}

async function getRevenueByContact(contactIds: string[]): Promise<Map<string, number>> {
  if (contactIds.length === 0) return new Map();
  const supabase = getSupabaseAdminClient();
  const revenue = new Map<string, number>();
  for (const batch of chunk(contactIds, IN_BATCH)) {
    const { data, error } = await supabase.from("bookings").select("contact_id, price_estimate").in("contact_id", batch);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ contact_id: string | null; price_estimate: number | null }>) {
      if (!row.contact_id) continue;
      revenue.set(row.contact_id, (revenue.get(row.contact_id) ?? 0) + (row.price_estimate ?? 0));
    }
  }
  return revenue;
}

export async function getClientDirectory(shopSlug: string) {
  const shop = await getShopBySlug(shopSlug);
  const [contacts, bookings] = await Promise.all([getContactsForShop(shop.id), getBookingsForShop(shop.id)]);

  const bookingsByContact = new Map<string, BookingWithRelations[]>();
  for (const booking of bookings) {
    if (!booking.contact_id) {
      continue;
    }

    const existing = bookingsByContact.get(booking.contact_id) ?? [];
    existing.push(booking);
    bookingsByContact.set(booking.contact_id, existing);
  }

  const entries = contacts
    .map((contact) => {
      const contactBookings = bookingsByContact.get(contact.id) ?? [];

      if (contactBookings.length === 0) {
        return null;
      }

      return {
        contact,
        latestBooking: contactBookings[0],
        bookingCount: contactBookings.length,
        totalRevenue: contactBookings.reduce((sum, booking) => sum + (booking.price_estimate ?? 0), 0),
      } satisfies ClientDirectoryEntry;
    })
    .filter((entry): entry is ClientDirectoryEntry => entry !== null)
    .sort((a, b) => b.latestBooking.scheduled_start.localeCompare(a.latestBooking.scheduled_start));

  return { shop, entries };
}

async function getVehiclesForContact(contactId: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, make, model, year, rego, size")
    .eq("contact_id", contactId)
    .order("year", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as VehicleRecord[];
}

/**
 * PostgREST limits result sets to 1000 rows by default. Wellington has
 * thousands of contacts/leads after the Orbis migration, so directory
 * queries must page through the full set explicitly.
 */
const PAGE_SIZE = 1000;

async function getContactsForShop(shopId: string) {
  const supabase = getSupabaseAdminClient();
  const all: ContactRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, shop_id, first_name, last_name, full_name, email, phone, notes, created_at, updated_at")
      .eq("shop_id", shopId)
      .not("archived", "eq", true)
      .order("updated_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as ContactRecord[];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}

async function getLeadsForContact(contactId: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("leads")
    .select("id, shop_id, contact_id, vehicle_id, source, source_detail, service_requested, notes, status, won_source, quote_subject, quote_body, quote_html, template_key, suggested_size, confidence, reason_code, internal_notes, approved_size, created_at, updated_at, booked_at")
    .eq("contact_id", contactId)
    .not("archived", "eq", true)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  const leads = (data ?? []) as LeadRecord[];
  const vehicleIds = [...new Set(leads.map((lead) => lead.vehicle_id).filter(Boolean))] as string[];
  const vehicles = await getVehiclesByIds(vehicleIds);
  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

  return leads.map((lead) => ({
    ...lead,
    vehicle: lead.vehicle_id ? vehicleMap.get(lead.vehicle_id) ?? null : null,
  })) satisfies LeadWithVehicle[];
}

async function getLeadsForShop(shopId: string) {
  const supabase = getSupabaseAdminClient();
  // Strip quote_html / quote_body / body_rendered etc — those are huge
  // (multi-KB per lead) and only the detail page needs them. Directory
  // listings only display id/contact/vehicle/status/service/dates.
  // Page through all rows to bypass PostgREST's 1000-row default.
  const all: LeadRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, shop_id, contact_id, vehicle_id, source, source_detail, service_requested, notes, status, won_source, template_key, suggested_size, confidence, reason_code, approved_size, created_at, updated_at, booked_at")
      .eq("shop_id", shopId)
      .not("archived", "eq", true)
      .order("updated_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as LeadRecord[];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  const leads = all;
  const vehicleIds = [...new Set(leads.map((lead) => lead.vehicle_id).filter(Boolean))] as string[];
  const vehicles = await getVehiclesByIds(vehicleIds);
  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

  return leads.map((lead) => ({
    ...lead,
    vehicle: lead.vehicle_id ? vehicleMap.get(lead.vehicle_id) ?? null : null,
  })) satisfies LeadWithVehicle[];
}

async function getBookingsForContact(contact: ContactRecord) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("contact_id", contact.id)
    .order("scheduled_start", { ascending: false });

  if (error) {
    throw error;
  }

  const bookings = (data ?? []) as BookingRecord[];
  const vehicleIds = [...new Set(bookings.map((booking) => booking.vehicle_id).filter(Boolean))] as string[];
  const vehicles = await getVehiclesByIds(vehicleIds);
  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

  return bookings.map((booking) => ({
    ...booking,
    contact,
    vehicle: booking.vehicle_id ? vehicleMap.get(booking.vehicle_id) ?? null : null,
  })) satisfies BookingWithRelations[];
}

async function getBookingsForShop(shopId: string) {
  const supabase = getSupabaseAdminClient();
  // Page through to bypass PostgREST's 1000-row cap (Wellington has ~1000
  // imported historical bookings).
  const bookings: BookingRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("shop_id", shopId)
      .order("scheduled_start", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as BookingRecord[];
    bookings.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  const contactIds = [...new Set(bookings.map((booking) => booking.contact_id).filter(Boolean))] as string[];
  const vehicleIds = [...new Set(bookings.map((booking) => booking.vehicle_id).filter(Boolean))] as string[];

  const [contacts, vehicles] = await Promise.all([getContactsByIds(contactIds), getVehiclesByIds(vehicleIds)]);
  const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));
  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

  return bookings.map((booking) => ({
    ...booking,
    contact: booking.contact_id ? contactMap.get(booking.contact_id) ?? null : null,
    vehicle: booking.vehicle_id ? vehicleMap.get(booking.vehicle_id) ?? null : null,
  })) satisfies BookingWithRelations[];
}

// Batch size for `.in()` queries — keeps the URL length safe (each UUID is
// ~36 chars; 200 ids × 36 ≈ 7KB which is well under typical 8KB caps).
const IN_BATCH = 200;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getContactsByIds(ids: string[]) {
  if (ids.length === 0) return [] as ContactRecord[];
  const supabase = getSupabaseAdminClient();
  const all: ContactRecord[] = [];
  for (const batch of chunk(ids, IN_BATCH)) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, shop_id, first_name, last_name, full_name, email, phone, created_at, updated_at")
      .in("id", batch);
    if (error) throw error;
    all.push(...((data ?? []) as ContactRecord[]));
  }
  return all;
}

async function getVehiclesByIds(ids: string[]) {
  if (ids.length === 0) return [] as VehicleRecord[];
  const supabase = getSupabaseAdminClient();
  const all: VehicleRecord[] = [];
  for (const batch of chunk(ids, IN_BATCH)) {
    const { data, error } = await supabase
      .from("vehicles")
      .select("id, make, model, year, rego, size")
      .in("id", batch);
    if (error) throw error;
    all.push(...((data ?? []) as VehicleRecord[]));
  }
  return all;
}

async function getEmailsForContact({
  contactId,
  leadIds,
}: {
  contactId: string;
  leadIds: string[];
}) {
  const supabase = getSupabaseAdminClient();
  const [contactMessagesResult, leadMessagesResult] = await Promise.all([
    supabase
      .from("email_messages")
      .select("id, shop_id, contact_id, lead_id, booking_id, template_id, provider_message_id, subject, body_rendered, status, sent_at, created_at")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false }),
    leadIds.length > 0
      ? supabase
          .from("email_messages")
          .select("id, shop_id, contact_id, lead_id, booking_id, template_id, provider_message_id, subject, body_rendered, status, sent_at, created_at")
          .in("lead_id", leadIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contactMessagesResult.error) {
    throw contactMessagesResult.error;
  }

  if (leadMessagesResult.error) {
    throw leadMessagesResult.error;
  }

  const merged = [...(contactMessagesResult.data ?? []), ...(leadMessagesResult.data ?? [])] as EmailMessageRecord[];
  const deduped = Array.from(new Map(merged.map((message) => [message.id, message])).values()).sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );

  const messageIds = deduped.map((message) => message.id);
  const events = await getEmailEventsByMessageIds(messageIds);
  const eventMap = new Map<string, EmailEventRecord[]>();

  for (const event of events) {
    const existing = eventMap.get(event.email_message_id) ?? [];
    existing.push(event);
    eventMap.set(event.email_message_id, existing);
  }

  return deduped.map((message) => ({
    ...message,
    events: (eventMap.get(message.id) ?? []).sort((a, b) => b.event_timestamp.localeCompare(a.event_timestamp)),
  })) satisfies EmailMessageWithEvents[];
}

async function getEmailEventsByMessageIds(ids: string[]) {
  if (ids.length === 0) {
    return [] as EmailEventRecord[];
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("email_events")
    .select("id, email_message_id, event_type, event_timestamp, metadata_json, created_at")
    .in("email_message_id", ids)
    .order("event_timestamp", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as EmailEventRecord[];
}
