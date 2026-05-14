/**
 * Quick rollup: new-booking value today + this week, per shop.
 * "New" = booking created_at within the window (not scheduled_start).
 * Excludes cancelled bookings (their price was zeroed by the trigger).
 *
 * Run: npx tsx scripts/booking-value-by-period.ts
 */

import fs from "node:fs";
import path from "node:path";

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

import { formatInTimeZone } from "date-fns-tz";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function fmt(n: number) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", minimumFractionDigits: 2 }).format(n);
}

/** Start-of-day in a given shop tz, as an ISO string with offset. */
function startOfDayIso(now: Date, tz: string, daysAgo = 0): string {
  const dateStr = formatInTimeZone(new Date(now.getTime() - daysAgo * 86400_000), tz, "yyyy-MM-dd");
  const offset = formatInTimeZone(now, tz, "XXX");
  return `${dateStr}T00:00:00${offset}`;
}

/** Start-of-week (Monday) in shop tz. */
function startOfWeekIso(now: Date, tz: string): string {
  const dayOfWeek = Number(formatInTimeZone(now, tz, "i")); // 1=Mon..7=Sun
  return startOfDayIso(now, tz, dayOfWeek - 1);
}

async function main() {
  const supabase = getSupabaseAdminClient();
  const { data: shops } = await supabase.from("shops").select("id, slug, name, timezone").order("slug");
  if (!shops) throw new Error("No shops");

  const now = new Date();

  console.log("\nNew bookings: $ value created today + this week (excludes cancelled)");
  console.log("Source field: bookings.created_at\n");

  for (const shop of shops) {
    const todayStart = startOfDayIso(now, shop.timezone);
    const weekStart = startOfWeekIso(now, shop.timezone);
    const todayLabel = formatInTimeZone(now, shop.timezone, "EEE d MMM");
    const weekLabel = formatInTimeZone(weekStart, shop.timezone, "EEE d MMM");

    const [todayRes, weekRes] = await Promise.all([
      supabase
        .from("bookings")
        .select("price_estimate")
        .eq("shop_id", shop.id)
        .neq("status", "cancelled")
        .gte("created_at", todayStart),
      supabase
        .from("bookings")
        .select("price_estimate")
        .eq("shop_id", shop.id)
        .neq("status", "cancelled")
        .gte("created_at", weekStart),
    ]);

    const todayRows = todayRes.data ?? [];
    const weekRows = weekRes.data ?? [];
    const todaySum = todayRows.reduce((a, r: any) => a + (r.price_estimate ?? 0), 0);
    const weekSum = weekRows.reduce((a, r: any) => a + (r.price_estimate ?? 0), 0);

    console.log(`── ${shop.name} ──`);
    console.log(`  Today  (from ${todayLabel}):  ${todayRows.length} booking${todayRows.length === 1 ? "" : "s"}  ${fmt(todaySum)}`);
    console.log(`  Week   (from ${weekLabel}): ${weekRows.length} booking${weekRows.length === 1 ? "" : "s"}  ${fmt(weekSum)}`);
    console.log("");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
