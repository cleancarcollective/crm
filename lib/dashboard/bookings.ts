import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parse,
  startOfMonth,
  startOfWeek
} from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type {
  BookingRecord,
  BookingWithRelations,
  CalendarDaySummary,
  ContactRecord,
  ShopRecord,
  VehicleRecord
} from "@/lib/dashboard/types";

/**
 * Look up a shop by slug. Used by webhooks where the slug arrives in the
 * payload. UI/dashboard helpers prefer requireCurrentShop() so the user's
 * session shop scopes the query.
 */
export async function getShopBySlug(slug: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("shops")
    .select("id, slug, name, timezone")
    .eq("slug", slug)
    .single();

  if (error) {
    throw error;
  }

  return data as ShopRecord;
}

export async function getShopById(id: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("shops")
    .select("id, slug, name, timezone")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data as ShopRecord;
}

function parseMonthKey(month: string | undefined, timezone: string) {
  if (!month) {
    return formatInTimeZone(new Date(), timezone, "yyyy-MM");
  }

  const parsed = parse(month, "yyyy-MM", new Date());
  if (Number.isNaN(parsed.getTime())) {
    return formatInTimeZone(new Date(), timezone, "yyyy-MM");
  }

  return format(parsed, "yyyy-MM");
}

export function getMonthNavigation(month: string | undefined, timezone: string) {
  const parsed = parseMonthKey(month, timezone);
  const current = parse(`${parsed}-01`, "yyyy-MM-dd", new Date());

  return {
    month: parsed,
    current,
    previous: format(addMonths(current, -1), "yyyy-MM"),
    next: format(addMonths(current, 1), "yyyy-MM")
  };
}

export async function getBookingsForMonth(month: string | undefined, shopSlug: string) {
  const shop = await getShopBySlug(shopSlug);
  const navigation = getMonthNavigation(month, shop.timezone);

  const monthStart = startOfMonth(navigation.current);
  const monthEnd = endOfMonth(navigation.current);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const startIso = formatInTimeZone(gridStart, shop.timezone, "yyyy-MM-dd'T'00:00:00XXX");
  const endIso = formatInTimeZone(addDays(gridEnd, 1), shop.timezone, "yyyy-MM-dd'T'00:00:00XXX");

  const bookings = await getBookingsForRange(shop.id, startIso, endIso);
  const days = buildCalendarDays(bookings, gridStart, gridEnd, monthStart, shop.timezone);

  return {
    shop,
    ...navigation,
    days
  };
}

export async function getBookingsForDay(day: string, shopSlug: string) {
  const shop = await getShopBySlug(shopSlug);
  const zonedDay = parse(day, "yyyy-MM-dd", new Date());

  if (Number.isNaN(zonedDay.getTime())) {
    throw new Error(`Invalid day: ${day}`);
  }

  const startIso = formatInTimeZone(zonedDay, shop.timezone, "yyyy-MM-dd'T'00:00:00XXX");
  const endIso = formatInTimeZone(addDays(zonedDay, 1), shop.timezone, "yyyy-MM-dd'T'00:00:00XXX");

  // getBookingsForRange now widens the lower bound by 14 days to pull
  // multi-day bookings that started earlier. Split them: real "day-of"
  // bookings vs continuations.
  const all = await getBookingsForRange(shop.id, startIso, endIso);
  const dayBookings: BookingWithRelations[] = [];
  const continuationBookings: BookingWithRelations[] = [];

  for (const booking of all) {
    const startKey = formatInTimeZone(booking.scheduled_start, shop.timezone, "yyyy-MM-dd");
    if (startKey === day) {
      dayBookings.push(booking);
      continue;
    }
    // Started before this day - is it still running?
    let endIsoEff: string | null = booking.scheduled_end ?? null;
    if (!endIsoEff && booking.duration_minutes && booking.duration_minutes > 0) {
      endIsoEff = new Date(new Date(booking.scheduled_start).getTime() + booking.duration_minutes * 60000).toISOString();
    }
    if (!endIsoEff) continue;
    const endKey = formatInTimeZone(endIsoEff, shop.timezone, "yyyy-MM-dd");
    if (endKey >= day) continuationBookings.push(booking);
  }

  return {
    shop,
    day,
    bookings: dayBookings,
    continuationBookings
  };
}

export async function getBookingById(id: string, shopSlug: string) {
  const shop = await getShopBySlug(shopSlug);
  const booking = await getBookingWithRelationsById(id, shop.id);

  if (!booking) {
    throw new Error(`Booking not found: ${id}`);
  }

  return {
    shop,
    booking
  };
}

async function getBookingsForRange(shopId: string, startIso: string, endIso: string) {
  const supabase = getSupabaseAdminClient();
  // Widen lower bound by 14 days so multi-day bookings that started
  // before the grid window still show on their continuation days
  // inside the window. Real-world jobs cap at ~2-3 days; 14d is safe.
  const widenedStartIso = new Date(new Date(startIso).getTime() - 14 * 86400000).toISOString();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("shop_id", shopId)
    .gte("scheduled_start", widenedStartIso)
    .lt("scheduled_start", endIso)
    // Hide cancelled bookings — they stay in the DB for history but
    // shouldn't clutter the calendar.
    .neq("status", "cancelled")
    .order("scheduled_start", { ascending: true });

  if (error) {
    throw error;
  }

  const bookings = (data ?? []) as BookingRecord[];
  return attachRelations(bookings);
}

export async function getBookingsWithRelationsForRange(shopId: string, startIso: string, endIso: string) {
  return getBookingsForRange(shopId, startIso, endIso);
}

export async function getBookingWithRelationsById(id: string, shopId: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("shop_id", shopId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const booking = data as BookingRecord;
  const [contact, vehicle] = await Promise.all([
    booking.contact_id ? getContactById(booking.contact_id) : Promise.resolve(null),
    booking.vehicle_id ? getVehicleById(booking.vehicle_id) : Promise.resolve(null)
  ]);

  return {
    ...booking,
    contact,
    vehicle
  } satisfies BookingWithRelations;
}

async function attachRelations(bookings: BookingRecord[]) {
  if (bookings.length === 0) {
    return [] as BookingWithRelations[];
  }

  const contactIds = [...new Set(bookings.map((booking) => booking.contact_id).filter(Boolean))] as string[];
  const vehicleIds = [...new Set(bookings.map((booking) => booking.vehicle_id).filter(Boolean))] as string[];

  const [contacts, vehicles] = await Promise.all([
    getContactsByIds(contactIds),
    getVehiclesByIds(vehicleIds)
  ]);

  const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));
  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

  return bookings.map((booking) => ({
    ...booking,
    contact: booking.contact_id ? contactMap.get(booking.contact_id) ?? null : null,
    vehicle: booking.vehicle_id ? vehicleMap.get(booking.vehicle_id) ?? null : null
  }));
}

async function getContactsByIds(ids: string[]) {
  if (ids.length === 0) {
    return [] as ContactRecord[];
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, full_name, email, phone")
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

async function getContactById(id: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, full_name, email, phone")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data as ContactRecord;
}

async function getVehicleById(id: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, make, model, year, rego, size")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data as VehicleRecord;
}

function buildCalendarDays(
  bookings: BookingWithRelations[],
  gridStart: Date,
  gridEnd: Date,
  monthStart: Date,
  timezone: string
) {
  // Two maps: start-day bookings vs continuation-day bookings.
  // Start day gets full attribution (count, revenue, duration).
  // Continuation days show the booking but don't inflate totals.
  const bookingsByDay = new Map<string, BookingWithRelations[]>();
  const continuationByDay = new Map<string, BookingWithRelations[]>();

  for (const booking of bookings) {
    const startKey = formatInTimeZone(booking.scheduled_start, timezone, "yyyy-MM-dd");
    const startArr = bookingsByDay.get(startKey) ?? [];
    startArr.push(booking);
    bookingsByDay.set(startKey, startArr);

    // Compute effective end: prefer scheduled_end, fall back to
    // scheduled_start + duration_minutes. Skip spanning if neither.
    let effectiveEndIso: string | null = booking.scheduled_end ?? null;
    if (!effectiveEndIso && booking.duration_minutes && booking.duration_minutes > 0) {
      effectiveEndIso = new Date(new Date(booking.scheduled_start).getTime() + booking.duration_minutes * 60000).toISOString();
    }
    if (!effectiveEndIso) continue;

    const endKey = formatInTimeZone(effectiveEndIso, timezone, "yyyy-MM-dd");
    if (endKey === startKey) continue; // single-day - nothing to span

    // Iterate day-by-day (in shop timezone) from start+1 to end.
    // Use noon-in-zone dates to sidestep DST edge cases.
    const startBoundary = parse(startKey, "yyyy-MM-dd", new Date());
    const endBoundary = parse(endKey, "yyyy-MM-dd", new Date());
    let cursor = addDays(startBoundary, 1);
    while (cursor <= endBoundary) {
      const key = format(cursor, "yyyy-MM-dd");
      const contArr = continuationByDay.get(key) ?? [];
      contArr.push(booking);
      continuationByDay.set(key, contArr);
      cursor = addDays(cursor, 1);
    }
  }

  const todayKey = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");

  return eachDayOfInterval({ start: gridStart, end: gridEnd }).map((day) => {
    const isoDate = format(day, "yyyy-MM-dd");
    const dayBookings = bookingsByDay.get(isoDate) ?? [];
    const contBookings = continuationByDay.get(isoDate) ?? [];

    return {
      isoDate,
      isCurrentMonth: isSameMonth(day, monthStart),
      isToday: isoDate === todayKey,
      bookingCount: dayBookings.length,
      totalRevenue: dayBookings.reduce((sum, booking) => sum + (booking.price_estimate ?? 0), 0),
      totalDurationMinutes: dayBookings.reduce((sum, booking) => sum + (booking.duration_minutes ?? 0), 0),
      bookings: dayBookings,
      continuationBookings: contBookings
    } satisfies CalendarDaySummary;
  });
}

export function getBookingDisplayName(booking: BookingWithRelations) {
  return (
    booking.contact?.full_name ||
    [booking.contact?.first_name, booking.contact?.last_name].filter(Boolean).join(" ") ||
    "Unknown customer"
  );
}

export function getVehicleLabel(booking: BookingWithRelations) {
  const parts = [booking.vehicle?.year, booking.vehicle?.make, booking.vehicle?.model].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Vehicle not linked";
}

export function getZonedDateKey(iso: string, timezone: string) {
  return formatInTimeZone(iso, timezone, "yyyy-MM-dd");
}

export function getZonedDateObject(iso: string, timezone: string) {
  return toZonedTime(iso, timezone);
}
