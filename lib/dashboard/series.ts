import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getShopById } from "@/lib/dashboard/bookings";
import type {
  BookingRecord,
  BookingSeriesRecord,
  ContactRecord,
  ShopRecord,
  VehicleRecord,
} from "@/lib/dashboard/types";

export type SeriesDetail = {
  series: BookingSeriesRecord;
  shop: ShopRecord;
  contact: ContactRecord | null;
  vehicle: VehicleRecord | null;
  /** Every occurrence, oldest first. Cancelled rows are INCLUDED so the
   *  staff view shows full history. */
  occurrences: BookingRecord[];
  stats: {
    total: number;
    completed: number;
    cancelled: number;
    upcoming: number;
    overridden: number;
    /** Sum of price_estimate across completed occurrences. */
    lifetimeRevenue: number;
  };
};

export async function getSeriesById(
  seriesId: string,
  shopId: string
): Promise<SeriesDetail | null> {
  const supabase = getSupabaseAdminClient();

  const { data: seriesRow, error: seriesErr } = await supabase
    .from("booking_series")
    .select("*")
    .eq("id", seriesId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (seriesErr || !seriesRow) {
    return null;
  }

  const series = seriesRow as BookingSeriesRecord;
  const shop = await getShopById(shopId);

  const [contactRes, vehicleRes, occurrencesRes] = await Promise.all([
    series.contact_id
      ? supabase
          .from("contacts")
          .select("id, first_name, last_name, full_name, email, phone, notes")
          .eq("id", series.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as const),
    series.vehicle_id
      ? supabase
          .from("vehicles")
          .select("id, make, model, year, rego, size")
          .eq("id", series.vehicle_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as const),
    // Cancelled occurrences are kept — staff need to see why a slot is gone.
    supabase
      .from("bookings")
      .select("*")
      .eq("shop_id", shopId)
      .eq("series_id", seriesId)
      .order("scheduled_start", { ascending: true }),
  ]);

  const contact = (contactRes.data as ContactRecord | null) ?? null;
  const vehicle = (vehicleRes.data as VehicleRecord | null) ?? null;
  const occurrences = ((occurrencesRes.data ?? []) as BookingRecord[]) ?? [];

  const nowIso = new Date().toISOString();
  let completed = 0;
  let cancelled = 0;
  let upcoming = 0;
  let overridden = 0;
  let lifetimeRevenue = 0;
  for (const b of occurrences) {
    if (b.status === "completed") {
      completed += 1;
      lifetimeRevenue += b.price_estimate ?? 0;
    } else if (b.status === "cancelled") {
      cancelled += 1;
    } else if (b.scheduled_start > nowIso) {
      upcoming += 1;
    }
    if (b.series_overridden) overridden += 1;
  }

  return {
    series,
    shop,
    contact,
    vehicle,
    occurrences,
    stats: {
      total: occurrences.length,
      completed,
      cancelled,
      upcoming,
      overridden,
      lifetimeRevenue,
    },
  };
}
