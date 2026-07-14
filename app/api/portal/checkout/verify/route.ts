/**
 * POST { email, code } → { ok, profile } | { ok: false, reason }
 *
 * Verifies the 6-digit checkout code and, only then, returns the
 * returning customer's profile: contact details, vehicles, and their
 * most recent booking per vehicle (max 3) for "book again" cards.
 */

import { NextRequest } from "next/server";

import { corsJson, corsPreflight } from "@/lib/portal/cors";
import { getMemberships } from "@/lib/portal/membership";
import { verifyCheckoutCode } from "@/lib/portal/otp";
import { getPortalContacts } from "@/lib/portal/session";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  let email = "";
  let code = "";
  try {
    const body = (await req.json()) as { email?: string; code?: string };
    email = (body.email ?? "").toLowerCase().trim();
    code = (body.code ?? "").trim();
  } catch {
    return corsJson({ error: "Invalid request" }, { status: 400 });
  }
  if (!email || !/^\d{6}$/.test(code)) {
    return corsJson({ ok: false, reason: "invalid" }, { status: 400 });
  }

  const result = await verifyCheckoutCode(email, code);
  if (result !== "ok") {
    return corsJson({ ok: false, reason: result }, { status: 401 });
  }

  const contacts = await getPortalContacts(email);
  if (contacts.length === 0) {
    return corsJson({ ok: false, reason: "invalid" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  const contactIds = contacts.map((c) => c.id);

  const [vehiclesRes, bookingsRes, shopsRes] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, contact_id, make, model, year, rego, size")
      .in("contact_id", contactIds),
    supabase
      .from("bookings")
      .select("id, shop_id, vehicle_id, service_name, status, scheduled_start, price_estimate, location_type, service_address")
      .in("contact_id", contactIds)
      .neq("status", "cancelled")
      .order("scheduled_start", { ascending: false })
      .limit(30),
    supabase.from("shops").select("id, slug, name"),
  ]);

  const shops = shopsRes.data ?? [];
  const shopSlug = (id: string) => shops.find((s) => s.id === id)?.slug ?? null;

  // Most recent booking per vehicle (nulls grouped as one), cap 3.
  const seen = new Set<string>();
  const lastBookings: Array<Record<string, unknown>> = [];
  for (const b of bookingsRes.data ?? []) {
    const key = b.vehicle_id ?? "none";
    if (seen.has(key)) continue;
    seen.add(key);
    lastBookings.push({
      service_name: b.service_name,
      scheduled_start: b.scheduled_start,
      price_estimate: b.price_estimate,
      location_type: b.location_type,
      service_address: b.service_address,
      shop_slug: shopSlug(b.shop_id),
      vehicle_id: b.vehicle_id,
    });
    if (lastBookings.length >= 3) break;
  }

  const primary = contacts[0];
  // Most recent mobile address for prefilling mobile jobs.
  const lastMobile = (bookingsRes.data ?? []).find((b) => b.location_type === "mobile" && b.service_address);

  const memberships = await getMemberships(contactIds);
  const isMember = memberships.some((m) => m.status === "active");

  return corsJson({
    ok: true,
    profile: {
      email,
      first_name: primary.first_name,
      last_name: primary.last_name,
      full_name: primary.full_name,
      phone: primary.phone,
      vehicles: vehiclesRes.data ?? [],
      last_bookings: lastBookings,
      last_mobile_address: lastMobile?.service_address ?? null,
      is_member: isMember,
      membership_status: memberships[0]?.status ?? null,
    },
  });
}
