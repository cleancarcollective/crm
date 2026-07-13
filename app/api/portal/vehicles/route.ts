/**
 * POST /api/portal/vehicles - add a vehicle to the customer's garage.
 * Body: { make, model, year?, rego?, size?, contact_id? }
 *
 * The vehicle attaches to one of the session's contact rows (vehicles
 * are shop-scoped). If contact_id is omitted we use the contact with
 * the most recent booking, falling back to the first contact.
 */

import { NextRequest, NextResponse } from "next/server";

import { getPortalContacts, getPortalSession } from "@/lib/portal/session";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { make?: string; model?: string; year?: string; rego?: string; size?: string; contact_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const make = (body.make ?? "").trim().slice(0, 60);
  const model = (body.model ?? "").trim().slice(0, 60);
  const year = (body.year ?? "").trim().slice(0, 8);
  const rego = (body.rego ?? "").trim().toUpperCase().slice(0, 12);
  if (!make && !model && !rego) {
    return NextResponse.json({ error: "Add at least a make/model or rego" }, { status: 400 });
  }

  const contacts = await getPortalContacts(session.email);
  if (contacts.length === 0) return NextResponse.json({ error: "No account found" }, { status: 404 });

  let target = body.contact_id ? contacts.find((c) => c.id === body.contact_id) : undefined;
  const supabase = getSupabaseAdminClient();

  if (!target) {
    // Most recent booking decides the "home" shop.
    const { data: recent } = await supabase
      .from("bookings")
      .select("contact_id")
      .in("contact_id", contacts.map((c) => c.id))
      .order("scheduled_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    target = contacts.find((c) => c.id === recent?.contact_id) ?? contacts[0];
  }

  const { data: vehicle, error } = await supabase
    .from("vehicles")
    .insert({
      shop_id: target.shop_id,
      contact_id: target.id,
      make: make || null,
      model: model || null,
      year: year || null,
      rego: rego || null,
      size: body.size?.trim() || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Portal vehicle insert failed", error);
    return NextResponse.json({ error: "Could not save vehicle" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: vehicle.id });
}

/**
 * DELETE /api/portal/vehicles?id=... - remove a vehicle from the garage.
 * Refuses when the vehicle is attached to an upcoming booking.
 */
export async function DELETE(req: NextRequest) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const contacts = await getPortalContacts(session.email);
  const contactIds = contacts.map((c) => c.id);
  const supabase = getSupabaseAdminClient();

  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("id, contact_id")
    .eq("id", id)
    .maybeSingle();
  if (!vehicle || !contactIds.includes(vehicle.contact_id)) {
    return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  }

  const { data: upcoming } = await supabase
    .from("bookings")
    .select("id")
    .eq("vehicle_id", id)
    .gte("scheduled_start", new Date().toISOString())
    .neq("status", "cancelled")
    .limit(1);
  if ((upcoming?.length ?? 0) > 0) {
    return NextResponse.json(
      { error: "This vehicle has an upcoming booking - change that first" },
      { status: 400 }
    );
  }

  await supabase.from("vehicles").update({ contact_id: null }).eq("id", id);
  return NextResponse.json({ ok: true });
}
