/**
 * Fire every customer-facing message a Wellington booking would generate
 * — confirmation email + SMS, week/day/hour reminders, day SMS reminder,
 * pickup-ready email + SMS, review SMS — to a single inbox + phone for
 * audit. All redirected to tebbs.max@gmail.com / 0210768973 regardless of
 * what's stored on the contact.
 *
 * Creates a real booking row in Wellington so FK constraints resolve.
 * Booking is tagged in notes as "[AUDIT FIRE]" so it's easy to delete.
 *
 * Run with: npx tsx scripts/audit-fire-wellington.ts
 */

import fs from "node:fs";
import path from "node:path";

import { addDays, addHours } from "date-fns";

function loadEnv(file: string) {
  const envPath = path.join(process.cwd(), file);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv(".env.local");
loadEnv(".env.vercel.local");

import type { BookingWithRelations, ShopRecord } from "@/lib/dashboard/types";
import { sendBookingEmail } from "@/lib/email/sendBookingEmail";
import { sendPickupReadyEmail } from "@/lib/email/sendPickupReadyEmail";
import { loadAndRenderSms } from "@/lib/sms/smsTemplateRenderer";
import { sendTnzSms } from "@/lib/sms/tnzClient";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const TARGET_EMAIL = "tebbs.max@gmail.com";
const TARGET_PHONE = "0210768973";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureContactAndVehicle(supabase: any, shopId: string) {
  // Reuse existing Max Tebbs Wellington contact if there is one (matches
  // by tebbs.max@gmail.com or 0210768973 on the same shop).
  const { data: existing } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, full_name, email, phone")
    .eq("shop_id", shopId)
    .or(`email.eq.${TARGET_EMAIL},phone.eq.${TARGET_PHONE}`)
    .limit(1)
    .maybeSingle();

  let contact = existing;
  if (!contact) {
    const { data: created, error } = await supabase
      .from("contacts")
      .insert({
        shop_id: shopId,
        first_name: "Max",
        last_name: "Tebbs",
        full_name: "Max Tebbs",
        email: TARGET_EMAIL,
        phone: TARGET_PHONE,
      })
      .select("id, first_name, last_name, full_name, email, phone")
      .single();
    if (error) throw error;
    contact = created;
  }

  // Reuse the most recent vehicle for that contact, or create one
  const { data: existingVehicle } = await supabase
    .from("vehicles")
    .select("id, year, make, model, rego, size")
    .eq("contact_id", contact.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let vehicle = existingVehicle;
  if (!vehicle) {
    const { data: created, error } = await supabase
      .from("vehicles")
      .insert({
        shop_id: shopId,
        contact_id: contact.id,
        year: "2024",
        make: "Tesla",
        model: "Model 3",
        rego: "AUDIT1",
        size: "medium",
      })
      .select("id, year, make, model, rego, size")
      .single();
    if (error) throw error;
    vehicle = created;
  }

  return { contact, vehicle };
}

async function main() {
  const supabase = getSupabaseAdminClient();

  // 1. Wellington shop
  const { data: shopRow, error: shopErr } = await supabase
    .from("shops")
    .select("id, slug, name, timezone")
    .eq("slug", "wellington")
    .single();
  if (shopErr || !shopRow) throw new Error("Wellington shop not found");
  const shop = shopRow as ShopRecord;

  // 2. Contact + vehicle (creating if needed)
  const { contact, vehicle } = await ensureContactAndVehicle(supabase, shop.id);

  // 3. Insert a real booking 7 days out, tagged so it's identifiable
  const scheduledStart = addDays(new Date(), 7);
  scheduledStart.setHours(11, 0, 0, 0);
  const scheduledEnd = addHours(scheduledStart, 4);

  const { data: bookingRow, error: bookingErr } = await supabase
    .from("bookings")
    .insert({
      shop_id: shop.id,
      contact_id: contact.id,
      vehicle_id: vehicle.id,
      booking_source: "audit-fire-script",
      service_name: "Inside and out package — Audit",
      service_details: "Mock booking for end-to-end message audit",
      scheduled_start: scheduledStart.toISOString(),
      scheduled_end: scheduledEnd.toISOString(),
      status: "confirmed",
      price_estimate: 350,
      notes: "[AUDIT FIRE] Created by scripts/audit-fire-wellington.ts — safe to delete.",
      duration_minutes: 240,
      location_type: "in_shop",
      raw_payload: {},
    })
    .select("*")
    .single();
  if (bookingErr || !bookingRow) throw bookingErr ?? new Error("booking insert failed");

  const booking: BookingWithRelations = {
    ...(bookingRow as any),
    contact,
    vehicle,
  };

  console.log(`\n→ Created audit booking ${booking.id} for Wellington`);
  console.log(`   Routing all emails to ${TARGET_EMAIL}, all SMS to ${TARGET_PHONE}\n`);

  // ── Emails (4 booking-* templates + pickup-ready) ──────────────────────
  const emailJobs: Array<{
    label: string;
    templateKey: Parameters<typeof sendBookingEmail>[0]["templateKey"];
    introLine: string;
    actionLine: string;
  }> = [
    {
      label: "1/8 booking-confirmation",
      templateKey: "booking-confirmation",
      introLine: `Your booking with ${shop.name} is confirmed.`,
      actionLine: "If you need to make any changes, reply to this email.",
    },
    {
      label: "2/8 booking-team-notification",
      templateKey: "booking-team-notification",
      introLine: "A new booking has been created in the CRM.",
      actionLine: "Review this booking in the CRM calendar if any prep or follow-up is required.",
    },
    {
      label: "3/8 booking-reminder-week",
      templateKey: "booking-reminder-week",
      introLine: `This is your one-week reminder for your upcoming booking with ${shop.name}.`,
      actionLine: "If anything has changed, reply to this email.",
    },
    {
      label: "4/8 booking-reminder-day",
      templateKey: "booking-reminder-day",
      introLine: `This is your one-day reminder for your upcoming booking with ${shop.name}.`,
      actionLine: "If anything has changed, reply to this email.",
    },
    {
      label: "5/8 booking-reminder-hour",
      templateKey: "booking-reminder-hour",
      introLine: `This is your one-hour reminder for your upcoming booking with ${shop.name}.`,
      actionLine: "We look forward to seeing you shortly.",
    },
  ];

  for (const job of emailJobs) {
    process.stdout.write(`  ${job.label}…`);
    const r = await sendBookingEmail({
      shop,
      booking,
      templateKey: job.templateKey,
      recipient: TARGET_EMAIL,
      introLine: job.introLine,
      actionLine: job.actionLine,
      firstName: "Max",
      includeCustomerDetails: job.templateKey === "booking-team-notification",
    });
    console.log(" sent", "skipped" in r && r.skipped ? `(skipped: ${(r as any).reason})` : "");
    await sleep(1200);
  }

  // 6/8 — Pickup-ready email (in-hours variant chosen by sendPickupReadyEmail)
  process.stdout.write(`  6/8 pickup-ready email…`);
  const pickupRes = await sendPickupReadyEmail({
    shop,
    firstName: "Max",
    customerEmail: TARGET_EMAIL,
    vehicleLabel: "2024 Tesla Model 3",
    bookingId: booking.id,
    contactId: contact.id,
  });
  console.log(` sent (afterHours=${pickupRes.afterHours})`);
  await sleep(1200);

  // ── SMSes ─────────────────────────────────────────────────────────────
  process.stdout.write(`  7/8 booking confirmation SMS…`);
  {
    const { body } = await loadAndRenderSms(shop.id, "booking_confirmation", {
      name: "Max",
      date_time: scheduledStart.toLocaleString("en-NZ", { timeZone: shop.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
    });
    const r = await sendTnzSms(TARGET_PHONE, body);
    console.log(r.success ? " sent" : ` FAILED: ${r.error}`);
  }
  await sleep(1500);

  process.stdout.write(`  8/8 booking-reminder-day SMS…`);
  {
    const { body } = await loadAndRenderSms(shop.id, "booking_reminder_day", {
      name: "Max",
      date_time: scheduledStart.toLocaleString("en-NZ", { timeZone: shop.timezone, weekday: "long", hour: "numeric", minute: "2-digit" }),
    });
    const r = await sendTnzSms(TARGET_PHONE, body);
    console.log(r.success ? " sent" : ` FAILED: ${r.error}`);
  }
  await sleep(1500);

  process.stdout.write(`  9/8 pickup-ready SMS (in-hours)…`);
  {
    const { body } = await loadAndRenderSms(shop.id, "pickup_normal", {
      name: "Max",
      vehicle: "2024 Tesla Model 3",
    });
    const r = await sendTnzSms(TARGET_PHONE, body);
    console.log(r.success ? " sent" : ` FAILED: ${r.error}`);
  }
  await sleep(1500);

  process.stdout.write(`  10/8 review-request SMS…`);
  {
    const { body } = await loadAndRenderSms(shop.id, "review_request", {
      name: "Max",
    });
    const r = await sendTnzSms(TARGET_PHONE, body);
    console.log(r.success ? " sent" : ` FAILED: ${r.error}`);
  }

  console.log(`\n✓ Done. Booking row id (delete after audit if desired): ${booking.id}`);
  console.log(`  Each message has a ~1.2s gap so they should arrive in order.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
