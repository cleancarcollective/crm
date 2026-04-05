import type { SupabaseClient } from "@supabase/supabase-js";

import type { NormalizedVehicleInput } from "@/lib/bookingIntake/types";

type VehicleRow = {
  id: string;
  shop_id: string;
  contact_id: string | null;
  make: string | null;
  model: string | null;
  year: string | null;
  rego: string | null;
  notes: string | null;
  size: string | null;
  created_at: string;
  updated_at: string;
};

export async function upsertVehicle(
  supabase: SupabaseClient,
  shopId: string,
  contactId: string,
  vehicle: NormalizedVehicleInput
) {
  let query = supabase
    .from("vehicles")
    .select("*")
    .eq("shop_id", shopId)
    .eq("contact_id", contactId);

  if (vehicle.make) {
    query = query.ilike("make", vehicle.make);
  } else {
    query = query.is("make", null);
  }

  if (vehicle.model) {
    query = query.ilike("model", vehicle.model);
  } else {
    query = query.is("model", null);
  }

  if (vehicle.year) {
    query = query.eq("year", vehicle.year);
  } else {
    query = query.is("year", null);
  }

  if (vehicle.normalizedRego) {
    query = query.ilike("rego", vehicle.normalizedRego);
  }

  const { data: matches, error: matchError } = await query.limit(2);

  if (matchError) {
    throw matchError;
  }

  if (matches.length === 1) {
    return matches[0] as VehicleRow;
  }

  const { data, error } = await supabase
    .from("vehicles")
    .insert({
      shop_id: shopId,
      contact_id: contactId,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      rego: vehicle.normalizedRego,
      size: vehicle.size,
      notes: vehicle.notes
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as VehicleRow;
}
