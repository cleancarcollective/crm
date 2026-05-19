/**
 * Shared contact + vehicle resolution for staff-created bookings.
 *
 * Both /api/bookings/manual and /api/booking-series accept either an
 * existing contact_id/vehicle_id OR an inline new_contact/new_vehicle
 * payload. Without this helper the dedupe + create logic would have to be
 * copy-pasted into each endpoint, and we'd silently break lead → booking
 * attribution if one branch lookup ever drifted from the other.
 *
 * Dedupe rules:
 *   - Look up existing contact by email (case-insensitive) first
 *   - Fall back to phone match
 *   - Only insert a fresh row if neither matches
 *
 * Returns the resolved contact id plus phone + first name (used by the
 * caller for SMS personalisation).
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type NewContactInput = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type NewVehicleInput = {
  make?: string | null;
  model?: string | null;
  year?: string | null;
  rego?: string | null;
  size?: string | null;
};

export type ResolveInput = {
  shopId: string;
  contactId?: string | null;
  newContact?: NewContactInput | null;
  vehicleId?: string | null;
  newVehicle?: NewVehicleInput | null;
};

export type ResolveResult = {
  contactId: string;
  contactPhone: string | null;
  contactFirstName: string | null;
  vehicleId: string | null;
};

export async function resolveContactAndVehicle(input: ResolveInput): Promise<ResolveResult> {
  if (!input.contactId && !input.newContact) {
    throw new Error("contactId or newContact is required");
  }

  const supabase = getSupabaseAdminClient();

  // ── Contact ────────────────────────────────────────────────────────
  let contactId: string;
  let contactPhone: string | null = null;
  let contactFirstName: string | null = null;

  if (input.contactId) {
    contactId = input.contactId;
    const { data: ct } = await supabase
      .from("contacts")
      .select("phone, first_name, full_name")
      .eq("id", contactId)
      .single();
    contactPhone = ct?.phone ?? null;
    contactFirstName = ct?.first_name ?? ct?.full_name?.split(" ")[0] ?? null;
  } else {
    const nc = input.newContact!;
    const fullName = [nc.first_name, nc.last_name].filter(Boolean).join(" ") || null;
    const normalizedEmail = nc.email?.toLowerCase().trim() || null;
    const normalizedPhone = nc.phone?.trim() || null;

    let existing: { id: string; phone: string | null; first_name: string | null; full_name: string | null } | null = null;

    if (normalizedEmail) {
      const { data } = await supabase
        .from("contacts")
        .select("id, phone, first_name, full_name")
        .eq("shop_id", input.shopId)
        .ilike("email", normalizedEmail)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      existing = data;
    }
    if (!existing && normalizedPhone) {
      const { data } = await supabase
        .from("contacts")
        .select("id, phone, first_name, full_name")
        .eq("shop_id", input.shopId)
        .eq("phone", normalizedPhone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      existing = data;
    }

    if (existing) {
      contactId = existing.id;
      contactPhone = existing.phone ?? normalizedPhone;
      contactFirstName = existing.first_name ?? existing.full_name?.split(" ")[0] ?? nc.first_name ?? null;
    } else {
      const { data: created, error } = await supabase
        .from("contacts")
        .insert({
          shop_id: input.shopId,
          first_name: nc.first_name ?? null,
          last_name: nc.last_name ?? null,
          full_name: fullName,
          email: normalizedEmail,
          phone: normalizedPhone,
        })
        .select("id, phone, first_name")
        .single();

      if (error || !created) {
        throw new Error(`Failed to create contact: ${error?.message ?? "unknown error"}`);
      }
      contactId = created.id;
      contactPhone = created.phone ?? null;
      contactFirstName = created.first_name ?? null;
    }
  }

  // ── Vehicle (optional) ────────────────────────────────────────────
  let vehicleId: string | null = null;

  if (input.vehicleId) {
    vehicleId = input.vehicleId;
  } else if (input.newVehicle && Object.values(input.newVehicle).some(Boolean)) {
    const nv = input.newVehicle;
    const { data: created, error } = await supabase
      .from("vehicles")
      .insert({
        shop_id: input.shopId,
        contact_id: contactId,
        make: nv.make ?? null,
        model: nv.model ?? null,
        year: nv.year ?? null,
        rego: nv.rego ?? null,
        size: nv.size ?? null,
      })
      .select("id")
      .single();

    if (error || !created) {
      throw new Error(`Failed to create vehicle: ${error?.message ?? "unknown error"}`);
    }
    vehicleId = created.id;
  }

  return { contactId, contactPhone, contactFirstName, vehicleId };
}
