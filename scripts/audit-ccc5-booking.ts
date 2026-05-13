/**
 * Audit the most recent Wellington booking that used CCC5 — print
 * subtotal, discount, final price, raw payload, and the stored
 * email-facing fields so we can see if anything's wrong end-to-end.
 */
import fs from "node:fs"; import path from "node:path";
function loadEnv(f:string){const p=path.join(process.cwd(),f);if(!fs.existsSync(p))return;for(const l of fs.readFileSync(p,"utf-8").split("\n")){const t=l.trim();if(!t||t.startsWith("#"))continue;const e=t.indexOf("=");if(e===-1)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}}
loadEnv(".env.local");
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
const sb = getSupabaseAdminClient();
(async () => {
  const { data: shop } = await sb.from("shops").select("id").eq("slug","wellington").single();
  const { data: bookings } = await sb
    .from("bookings")
    .select("id, service_name, price_estimate, notes, raw_payload, created_at, scheduled_start, contact:contacts(full_name, email)")
    .eq("shop_id", shop!.id)
    .ilike("notes", "%CCC5%")
    .order("created_at", { ascending: false })
    .limit(3);
  if (!bookings || bookings.length === 0) {
    console.log("No CCC5 bookings found.");
    return;
  }
  for (const b of bookings as any[]) {
    console.log("=".repeat(60));
    console.log("Booking:    ", b.id);
    console.log("Customer:   ", b.contact?.full_name, "<"+b.contact?.email+">");
    console.log("Service:    ", b.service_name);
    console.log("Scheduled:  ", b.scheduled_start);
    console.log("Stored price:", "$"+b.price_estimate);
    console.log("Notes:");
    console.log("  " + (b.notes || "").replace(/\n/g, "\n  "));
    const rp = b.raw_payload ?? {};
    console.log("Raw payload pricing fields:");
    console.log("  total_price:  ", rp.total_price);
    console.log("  Price:        ", rp.Price);
    console.log("  promo_code:   ", rp.promo_code);
    console.log("  services_array:", rp.services_array);
    console.log("  vehicle_size: ", rp.vehicle_size);
    console.log("");
  }
})();
