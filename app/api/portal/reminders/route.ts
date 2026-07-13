/**
 * POST /api/portal/reminders - create a detail-due reminder.
 * Body: { cadence_months, contact_id?, vehicle_id?, service_name?, start_from? }
 *
 * PATCH /api/portal/reminders - update one.
 * Body: { id, action: "pause" | "resume" | "cancel" | "cadence", cadence_months? }
 */

import { NextRequest, NextResponse } from "next/server";

import { getPortalContacts, getPortalSession } from "@/lib/portal/session";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export async function POST(req: NextRequest) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: {
    cadence_months?: number;
    contact_id?: string;
    vehicle_id?: string;
    service_name?: string;
    start_from?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const cadence = Number(body.cadence_months);
  if (!Number.isInteger(cadence) || cadence < 1 || cadence > 12) {
    return NextResponse.json({ error: "Cadence must be 1-12 months" }, { status: 400 });
  }

  const contacts = await getPortalContacts(session.email);
  if (contacts.length === 0) return NextResponse.json({ error: "No account found" }, { status: 404 });

  const supabase = getSupabaseAdminClient();

  let target = body.contact_id ? contacts.find((c) => c.id === body.contact_id) : undefined;
  if (!target) {
    const { data: recent } = await supabase
      .from("bookings")
      .select("contact_id")
      .in("contact_id", contacts.map((c) => c.id))
      .order("scheduled_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    target = contacts.find((c) => c.id === recent?.contact_id) ?? contacts[0];
  }

  // Vehicle (optional) must belong to the customer.
  let vehicleId: string | null = null;
  if (body.vehicle_id) {
    const { data: v } = await supabase
      .from("vehicles")
      .select("id, contact_id")
      .eq("id", body.vehicle_id)
      .maybeSingle();
    if (v && contacts.some((c) => c.id === v.contact_id)) vehicleId = v.id;
  }

  // Anchor: explicit start date, else the most recent completed booking,
  // else now. Reminder fires cadence months after the anchor.
  let anchor = new Date();
  if (body.start_from && !Number.isNaN(Date.parse(body.start_from))) {
    anchor = new Date(body.start_from);
  } else {
    const { data: lastBooking } = await supabase
      .from("bookings")
      .select("scheduled_start")
      .in("contact_id", contacts.map((c) => c.id))
      .lte("scheduled_start", new Date().toISOString())
      .neq("status", "cancelled")
      .order("scheduled_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastBooking) anchor = new Date(lastBooking.scheduled_start);
  }
  let nextDue = addMonths(anchor, cadence);
  // Never schedule into the past - roll forward until future.
  while (nextDue.getTime() < Date.now()) nextDue = addMonths(nextDue, cadence);

  const { data: created, error } = await supabase
    .from("portal_reminders")
    .insert({
      contact_id: target.id,
      shop_id: target.shop_id,
      vehicle_id: vehicleId,
      cadence_months: cadence,
      next_due_at: nextDue.toISOString(),
      service_name: body.service_name?.trim().slice(0, 120) || null,
      status: "active",
    })
    .select("id, next_due_at")
    .single();

  if (error) {
    console.error("Portal reminder insert failed", error);
    return NextResponse.json({ error: "Could not save reminder" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: created.id, next_due_at: created.next_due_at });
}

export async function PATCH(req: NextRequest) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { id?: string; action?: string; cadence_months?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const contacts = await getPortalContacts(session.email);
  const contactIds = contacts.map((c) => c.id);
  const supabase = getSupabaseAdminClient();

  const { data: reminder } = await supabase
    .from("portal_reminders")
    .select("id, contact_id, cadence_months, next_due_at, status")
    .eq("id", body.id)
    .maybeSingle();
  if (!reminder || !contactIds.includes(reminder.contact_id)) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.action === "pause") patch.status = "paused";
  else if (body.action === "resume") patch.status = "active";
  else if (body.action === "cancel") patch.status = "cancelled";
  else if (body.action === "cadence") {
    const cadence = Number(body.cadence_months);
    if (!Number.isInteger(cadence) || cadence < 1 || cadence > 12) {
      return NextResponse.json({ error: "Cadence must be 1-12 months" }, { status: 400 });
    }
    patch.cadence_months = cadence;
    let next = addMonths(new Date(), cadence);
    // Keep the sooner of (existing due date, now + new cadence) so
    // shortening the cadence brings the reminder forward.
    const existing = new Date(reminder.next_due_at);
    if (existing.getTime() > Date.now() && existing.getTime() < next.getTime()) next = existing;
    patch.next_due_at = next.toISOString();
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  await supabase.from("portal_reminders").update(patch).eq("id", reminder.id);
  return NextResponse.json({ ok: true });
}
