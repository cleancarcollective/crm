/**
 * Investigate a single contact's data — find every contact row matching
 * an email/phone/name, plus their leads + bookings. Used to debug
 * contact_id linkage issues where a customer booked but the lead still
 * looks pending because the booking was attached to a different contact.
 *
 * Usage: npx tsx scripts/investigate-contact.ts <email-or-phone-or-name>
 */

import fs from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("Usage: npx tsx scripts/investigate-contact.ts <email|phone|name>");
    process.exit(1);
  }

  const supabase = getSupabaseAdminClient();

  // Search contacts loosely on email, phone, first_name, last_name
  const q = `email.ilike.%${query}%,phone.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`;
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id, shop_id, first_name, last_name, email, phone, created_at")
    .or(q);

  if (error) throw error;
  if (!contacts || contacts.length === 0) {
    console.log("No contacts matched.");
    return;
  }

  console.log(`Found ${contacts.length} contact${contacts.length === 1 ? "" : "s"} matching "${query}":\n`);
  for (const c of contacts) {
    console.log(`Contact ${c.id}`);
    console.log(`  Name : ${c.first_name ?? ""} ${c.last_name ?? ""}`);
    console.log(`  Email: ${c.email ?? "—"}`);
    console.log(`  Phone: ${c.phone ?? "—"}`);
    console.log(`  Shop : ${c.shop_id}`);
    console.log(`  Created: ${c.created_at}`);

    const { data: leads } = await supabase
      .from("leads")
      .select("id, source, status, service_requested, created_at")
      .eq("contact_id", c.id)
      .order("created_at", { ascending: false });
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, status, service_name, price_estimate, created_at, scheduled_start")
      .eq("contact_id", c.id)
      .order("created_at", { ascending: false });
    const { data: emails } = await supabase
      .from("email_messages")
      .select("id, subject, status, sent_at")
      .eq("contact_id", c.id)
      .order("sent_at", { ascending: false, nullsFirst: false });

    console.log(`  Leads (${leads?.length ?? 0}):`);
    for (const l of leads ?? []) {
      console.log(`    - ${l.created_at.slice(0, 19)} ${l.status.padEnd(15)} ${l.service_requested ?? "—"} (lead ${l.id.slice(0, 8)})`);
    }
    console.log(`  Bookings (${bookings?.length ?? 0}):`);
    for (const b of bookings ?? []) {
      console.log(`    - ${b.created_at.slice(0, 19)} ${b.status.padEnd(12)} ${b.service_name ?? "—"} $${b.price_estimate ?? "—"} sched: ${b.scheduled_start ? b.scheduled_start.slice(0, 16) : "—"} (booking ${b.id.slice(0, 8)})`);
    }
    console.log(`  Emails (${emails?.length ?? 0}):`);
    for (const e of emails ?? []) {
      console.log(`    - ${(e.sent_at ?? e.subject).slice ? (e.sent_at ?? "—").slice(0, 19) : "—"} ${e.status.padEnd(7)} ${e.subject?.slice(0, 60) ?? ""}`);
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
