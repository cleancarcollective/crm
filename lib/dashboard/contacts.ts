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

export async function getContactProfileById(id: string) {
  const supabase = getSupabaseAdminClient();
  const { data: contact, error } = await supabase
    .from("contacts")
    .select("id, shop_id, first_name, last_name, full_name, email, phone, created_at, updated_at")
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

  const [vehicles, leads, bookings] = await Promise.all([
    getVehiclesForContact(typedContact.id),
    getLeadsForContact(typedContact.id),
    getBookingsForContact(typedContact),
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
  } satisfies ContactProfile;
}

export async function getLeadDirectory(shopSlug = "christchurch") {
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

export async function getClientDirectory(shopSlug = "christchurch") {
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

async function getContactsForShop(shopId: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("id, shop_id, first_name, last_name, full_name, email, phone, created_at, updated_at")
    .eq("shop_id", shopId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as ContactRecord[];
}

async function getLeadsForContact(contactId: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("leads")
    .select("id, shop_id, contact_id, vehicle_id, source, source_detail, service_requested, notes, status, created_at, updated_at, booked_at")
    .eq("contact_id", contactId)
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
  const { data, error } = await supabase
    .from("leads")
    .select("id, shop_id, contact_id, vehicle_id, source, source_detail, service_requested, notes, status, created_at, updated_at, booked_at")
    .eq("shop_id", shopId)
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
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("shop_id", shopId)
    .order("scheduled_start", { ascending: false });

  if (error) {
    throw error;
  }

  const bookings = (data ?? []) as BookingRecord[];
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

async function getContactsByIds(ids: string[]) {
  if (ids.length === 0) {
    return [] as ContactRecord[];
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("id, shop_id, first_name, last_name, full_name, email, phone, created_at, updated_at")
    .in("id", ids);

  if (error) {
    throw error;
  }

  return (data ?? []) as ContactRecord[];
}

async function getVehiclesByIds(ids: string[]) {
  if (ids.length === 0) {
    return [] as VehicleRecord[];
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, make, model, year, rego, size")
    .in("id", ids);

  if (error) {
    throw error;
  }

  return (data ?? []) as VehicleRecord[];
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
