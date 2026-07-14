/**
 * Backfill coating_warranties from every historical ceramic-coating
 * booking (both shops). Idempotent: unique index on booking_id makes
 * re-runs skip existing rows.
 *
 * Tier detection from service_name: gold / silver ("3 year") / bronze;
 * anything untiered gets tier=unknown with expires_at null (term to be
 * confirmed by staff). Terms: bronze 1yr, silver 3yr, gold 5yr.
 * Every warranty starts with 3 included maintenance washes (the
 * standing ceramic offer) - adjust individual rows in the DB if a
 * particular job didn't include them.
 *
 * next_wash_due_at = the next 6-month anniversary of application that
 * lies in the future (past anniversaries for old coatings are skipped,
 * not spammed).
 *
 * Usage: npx tsx scripts/backfill-coating-warranties.ts
 */

import fs from "node:fs";
import path from "node:path";
function loadEnv(f: string) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf-8").split("\n")) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const e = t.indexOf("=");
    if (e === -1) continue;
    const k = t.slice(0, e).trim();
    let v = t.slice(e + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(".env.local");

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function detectTier(name: string): "bronze" | "silver" | "gold" | "unknown" {
  const s = name.toLowerCase();
  if (s.includes("gold")) return "gold";
  if (s.includes("silver") || s.includes("3 year")) return "silver";
  if (s.includes("bronze")) return "bronze";
  return "unknown";
}

const TERM_MONTHS: Record<string, number | null> = {
  bronze: 12,
  silver: 36,
  gold: 60,
  unknown: null,
};

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function nextFutureAnniversary(appliedAt: Date, stepMonths: number): Date {
  let next = addMonths(appliedAt, stepMonths);
  while (next.getTime() < Date.now()) next = addMonths(next, stepMonths);
  return next;
}

(async () => {
  const supabase = getSupabaseAdminClient();
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, shop_id, contact_id, vehicle_id, service_name, status, scheduled_start, notes")
    .ilike("service_name", "%ceramic%")
    .neq("status", "cancelled")
    .order("scheduled_start", { ascending: true });

  let created = 0;
  let skipped = 0;

  for (const b of bookings ?? []) {
    const name = b.service_name ?? "";
    const lower = name.toLowerCase();
    // Consultations and standalone glass/leather/fabric ceramic add-ons
    // aren't paint-coating warranties.
    if (lower.includes("consultation")) { skipped += 1; continue; }
    const isPaintCoating =
      /ceramic coating/i.test(name) || /(gold|silver|bronze).*ceramic/i.test(name) || /ceramic.*(gold|silver|bronze)/i.test(name) || lower.trim() === "ceramic coating";
    if (!isPaintCoating) { skipped += 1; continue; }
    if (!b.contact_id) { skipped += 1; continue; }
    // Only warranty jobs that have actually happened.
    if (new Date(b.scheduled_start).getTime() > Date.now()) { skipped += 1; continue; }

    const tier = detectTier(name);
    const applied = new Date(b.scheduled_start);
    const termMonths = TERM_MONTHS[tier];
    const expiresAt = termMonths ? addMonths(applied, termMonths) : null;
    const expired = expiresAt ? expiresAt.getTime() < Date.now() : false;

    const { error } = await supabase.from("coating_warranties").insert({
      booking_id: b.id,
      contact_id: b.contact_id,
      shop_id: b.shop_id,
      vehicle_id: b.vehicle_id,
      coating_name: name,
      tier,
      applied_at: applied.toISOString(),
      expires_at: expiresAt?.toISOString() ?? null,
      washes_included: /ceramic winter ad funnel|free maintenance wash/i.test(b.notes ?? "") ? 3 : 0,
      washes_used: 0,
      next_wash_due_at: expired ? null : nextFutureAnniversary(applied, 6).toISOString(),
      status: expired ? "expired" : "active",
      notes: tier === "unknown" ? "Backfilled - tier/term to be confirmed" : "Backfilled from booking history",
    });
    if (error) {
      if (error.code === "23505") { skipped += 1; continue; } // already backfilled
      console.error("insert failed", b.id, error.message);
      continue;
    }
    created += 1;
    console.log(`${applied.toISOString().slice(0, 10)}  ${tier.padEnd(7)}  ${expired ? "EXPIRED" : "active "}  ${name}`);
  }

  console.log(`\nCreated ${created}, skipped ${skipped}.`);
})();
