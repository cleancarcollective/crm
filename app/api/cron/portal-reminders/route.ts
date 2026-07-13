/**
 * Daily cron: send detail-due reminder emails for portal_reminders
 * whose next_due_at has arrived, then roll next_due_at forward by the
 * cadence. Authed by CRON_SECRET bearer (same convention as the other
 * cron routes).
 */

import { NextRequest, NextResponse } from "next/server";

import { sendDetailDueEmail } from "@/lib/portal/emails";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  // Priority window: fire when now >= next_due_at - notify_days_before.
  // Widest window is 30 days, so pre-filter in SQL to due-within-30d and
  // apply the per-row offset in code.
  const { data: candidates } = await supabase
    .from("portal_reminders")
    .select("id, contact_id, shop_id, vehicle_id, cadence_months, next_due_at, service_name, notify_days_before")
    .eq("status", "active")
    .lte("next_due_at", new Date(Date.now() + 30 * 86400000).toISOString())
    .limit(200);

  const now = Date.now();
  const due = (candidates ?? []).filter((r) => {
    const windowOpens = new Date(r.next_due_at).getTime() - (r.notify_days_before ?? 7) * 86400000;
    return windowOpens <= now;
  }).slice(0, 50);

  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  let sent = 0;
  const errors: string[] = [];

  for (const reminder of due) {
    try {
      const [{ data: contact }, { data: shop }, { data: vehicle }] = await Promise.all([
        supabase
          .from("contacts")
          .select("id, first_name, email")
          .eq("id", reminder.contact_id)
          .single(),
        supabase.from("shops").select("id, slug, name, timezone").eq("id", reminder.shop_id).single(),
        reminder.vehicle_id
          ? supabase.from("vehicles").select("make, model, year").eq("id", reminder.vehicle_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (!contact?.email || !shop) {
        // Orphaned reminder - pause it so we don't retry forever.
        await supabase.from("portal_reminders").update({ status: "paused" }).eq("id", reminder.id);
        continue;
      }

      // Last non-cancelled past booking = "since your last visit" anchor.
      const { data: lastBooking } = await supabase
        .from("bookings")
        .select("scheduled_start")
        .eq("contact_id", contact.id)
        .lte("scheduled_start", new Date().toISOString())
        .neq("status", "cancelled")
        .order("scheduled_start", { ascending: false })
        .limit(1)
        .maybeSingle();

      const vehicleLabel = vehicle
        ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || null
        : null;

      await sendDetailDueEmail({
        email: contact.email,
        firstName: contact.first_name,
        shopId: shop.id,
        shopSlug: shop.slug,
        contactId: contact.id,
        vehicleLabel,
        serviceName: reminder.service_name,
        cadenceMonths: reminder.cadence_months,
        lastVisitAt: lastBooking?.scheduled_start ?? null,
        timezone: shop.timezone,
        dueAt: reminder.next_due_at,
      });

      // Roll forward to the next cycle.
      let next = addMonths(new Date(reminder.next_due_at), reminder.cadence_months);
      while (next.getTime() < Date.now()) next = addMonths(next, reminder.cadence_months);
      await supabase
        .from("portal_reminders")
        .update({
          next_due_at: next.toISOString(),
          last_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", reminder.id);

      sent += 1;
    } catch (err) {
      console.error("portal reminder send failed", reminder.id, err);
      errors.push(reminder.id);
    }
  }

  return NextResponse.json({ ok: true, sent, failed: errors.length });
}
