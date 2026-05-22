import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser, requireCurrentShop } from "@/lib/auth/currentShop";
import { getShopById } from "@/lib/dashboard/bookings";
import { scheduleBookingReminderSms } from "@/lib/sms/scheduledSmsJobs";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const shop = await requireCurrentShop();
  const user = await getCurrentUser();
  const body = await req.json();
  const { notes, first_name, last_name, full_name, email, phone } = body as {
    notes?: string;
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
  };

  // Sales role can ONLY update notes. Reject any contact-detail edit at the
  // server boundary - never trust UI hiding.
  if (user?.role === "sales") {
    const detailKeys = { first_name, last_name, full_name, email, phone };
    const attempted = Object.entries(detailKeys).some(([, v]) => v !== undefined);
    if (attempted) {
      return NextResponse.json(
        { error: "Sales role cannot edit contact details" },
        { status: 403 }
      );
    }
  }

  const supabase = getSupabaseAdminClient();

  // Load the existing row up front so we can detect what actually changed -
  // we'll rebuild pending SMS reminder jobs if phone or first_name shifts.
  const { data: before } = await supabase
    .from("contacts")
    .select("first_name, last_name, full_name, phone")
    .eq("id", id)
    .eq("shop_id", shop.id)
    .maybeSingle();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (notes !== undefined) updates.notes = notes;

  // Empty string → null so the DB stays clean.
  const norm = (v: string | null | undefined) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const t = v.trim();
    return t.length === 0 ? null : t;
  };

  const first = norm(first_name);
  const last = norm(last_name);
  let fullProvided = norm(full_name);

  if (first !== undefined) updates.first_name = first;
  if (last !== undefined) updates.last_name = last;

  // Recompute full_name from first+last when either changed and the caller
  // didn't override it explicitly.
  if (fullProvided === undefined && (first !== undefined || last !== undefined)) {
    if (before) {
      const f = first !== undefined ? first : before.first_name;
      const l = last !== undefined ? last : before.last_name;
      fullProvided = [f, l].filter(Boolean).join(" ") || null;
    }
  }
  if (fullProvided !== undefined) updates.full_name = fullProvided;

  const emailNorm = norm(email);
  if (emailNorm !== undefined) {
    updates.email = emailNorm ? emailNorm.toLowerCase() : null;
  }

  const phoneNorm = norm(phone);
  if (phoneNorm !== undefined) updates.phone = phoneNorm;

  const { error, count } = await supabase
    .from("contacts")
    .update(updates, { count: "exact" })
    .eq("id", id)
    .eq("shop_id", shop.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if ((count ?? 0) === 0) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  // If phone or first_name changed, the pending booking-reminder SMS jobs
  // for this contact's future bookings will go to the OLD number / quote
  // the OLD name (both are pre-rendered onto the job row at schedule time).
  // Cancel + rebuild so the next reminder uses the current contact info.
  const phoneChanged = phoneNorm !== undefined && before && phoneNorm !== before.phone;
  const firstNameChanged = first !== undefined && before && first !== before.first_name;
  if (phoneChanged || firstNameChanged) {
    try {
      await rebuildPendingSmsForContact(id, shop.id);
    } catch (err) {
      console.error("Failed to rebuild pending SMS after contact update", { contactId: id, err });
      // Non-fatal - the contact update itself committed.
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * Cancel pending booking-reminder SMS jobs for every future booking
 * belonging to this contact, then re-create them with the current phone +
 * first name. Touchpoint SMS (post-detail offers) render at send-time so
 * are immune; we skip them via the template_key IS NULL filter.
 */
async function rebuildPendingSmsForContact(contactId: string, shopId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  // Fetch future, non-terminal bookings for this contact.
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, scheduled_start, shop_id")
    .eq("contact_id", contactId)
    .eq("shop_id", shopId)
    .gt("scheduled_start", nowIso)
    .not("status", "in", "(cancelled,completed,no_show)");

  if (!bookings || bookings.length === 0) return;

  const bookingIds = bookings.map((b) => b.id as string);

  // Cancel only the day-before booking reminders (template_key IS NULL).
  // Post-detail touchpoints render at send time and don't carry stale info.
  await supabase
    .from("scheduled_sms_jobs")
    .update({ status: "cancelled", last_error: "Contact phone/name updated - rebuilding" })
    .in("booking_id", bookingIds)
    .eq("status", "pending")
    .is("template_key", null);

  // Pull the fresh contact for the re-schedule.
  const { data: contact } = await supabase
    .from("contacts")
    .select("phone, first_name, full_name")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact?.phone) return; // No phone - nothing to send.

  const shop = await getShopById(shopId);
  const firstName = (contact.first_name as string | null) ?? (contact.full_name as string | null)?.split(" ")[0] ?? "there";

  for (const b of bookings) {
    try {
      await scheduleBookingReminderSms({
        bookingId: b.id as string,
        contactId,
        shopId,
        phone: contact.phone as string,
        firstName,
        scheduledStart: b.scheduled_start as string,
        timezone: shop.timezone,
      });
    } catch (err) {
      console.error("Failed to re-schedule SMS after contact change", { bookingId: b.id, err });
    }
  }
}
