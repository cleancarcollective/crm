import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type {
  BookingRecord,
  BookingWithRelations,
  ContactProfile,
  ContactRecord,
  EmailEventRecord,
  EmailMessageRecord,
  EmailMessageWithEvents,
  LeadRecord,
  LeadWithVehicle,
  VehicleRecord,
} from "@/lib/dashboard/types";
import { getShopById } from "@/lib/dashboard/bookings";

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
