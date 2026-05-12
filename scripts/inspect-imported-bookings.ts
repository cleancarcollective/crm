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

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

async function main() {
  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("slug", "wellington").single();
  if (!shop) throw new Error("no wellington");

  // All wellington bookings, broken down by source
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, booking_source, status, scheduled_start, price_estimate, service_name")
    .eq("shop_id", shop.id);

  if (!bookings) return;

  const now = new Date();
  const horizon7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const horizon14 = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const buckets = {
    bySource: new Map<string, number>(),
    futureCount: 0,
    futureBySource: new Map<string, number>(),
    next7: 0,
    next14: 0,
    pastWithPrice: 0,
    pastWithoutPrice: 0,
    futureWithPrice: 0,
    futureWithoutPrice: 0,
  };

  for (const b of bookings) {
    const src = b.booking_source ?? "(null)";
    buckets.bySource.set(src, (buckets.bySource.get(src) ?? 0) + 1);
    const start = new Date(b.scheduled_start);
    const isFuture = start > now;
    const hasPrice = (b.price_estimate ?? 0) > 0;
    if (isFuture) {
      buckets.futureCount++;
      buckets.futureBySource.set(src, (buckets.futureBySource.get(src) ?? 0) + 1);
      if (start <= horizon7) buckets.next7++;
      if (start <= horizon14) buckets.next14++;
      if (hasPrice) buckets.futureWithPrice++; else buckets.futureWithoutPrice++;
    } else {
      if (hasPrice) buckets.pastWithPrice++; else buckets.pastWithoutPrice++;
    }
  }

  console.log(`Wellington bookings total: ${bookings.length}\n`);
  console.log("By booking_source:");
  for (const [s, n] of buckets.bySource) console.log(`  ${s}: ${n}`);
  console.log(`\nFuture: ${buckets.futureCount}`);
  for (const [s, n] of buckets.futureBySource) console.log(`  ${s}: ${n}`);
  console.log(`\nNext 7 days: ${buckets.next7}`);
  console.log(`Next 14 days: ${buckets.next14}`);
  console.log(`\nPrices:`);
  console.log(`  past with price>0: ${buckets.pastWithPrice}`);
  console.log(`  past with price=0/null: ${buckets.pastWithoutPrice}`);
  console.log(`  future with price>0: ${buckets.futureWithPrice}`);
  console.log(`  future with price=0/null: ${buckets.futureWithoutPrice}`);

  // Show next ~7 day bookings
  const upcoming = bookings
    .filter((b) => {
      const s = new Date(b.scheduled_start);
      return s > now && s <= horizon7;
    })
    .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime());

  if (upcoming.length > 0) {
    console.log(`\nUpcoming next 7 days:`);
    for (const u of upcoming) {
      console.log(`  ${u.scheduled_start.slice(0, 16)}  ${u.booking_source.padEnd(28)}  ${(u.service_name ?? "—").padEnd(40)}  $${u.price_estimate ?? 0}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
