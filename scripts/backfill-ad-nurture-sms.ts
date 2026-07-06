/**
 * One-off backfill: schedule the day-4 nurture SMS for existing road-trip
 * ad leads that have a phone number. Timing is relative to each lead's
 * created_at (+4d); leads whose window already passed are skipped (their
 * remaining email touches carry the sequence). Idempotent via the unique
 * (shop_id, lead_id, template_key) index.
 *
 * Usage:
 *   npx tsx scripts/backfill-ad-nurture-sms.ts          # dry run
 *   npx tsx scripts/backfill-ad-nurture-sms.ts --apply
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
loadEnv(".env.vercel.local");

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { scheduleAdNurtureSms, type AdNurturePayload } from "@/lib/autorespond/adNurture";

const APPLY = process.argv.includes("--apply");
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const supabase = getSupabaseAdminClient();
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, shop_id, contact_id, created_at, contacts(first_name, email, phone), vehicles(make, model)")
    .ilike("landing_url", "%road-trip%")
    .eq("status", "sent")
    .is("email_bounced_at", null);
  if (error) throw error;

  let planned = 0;
  for (const lead of leads ?? []) {
    const contact = lead.contacts as unknown as { first_name: string | null; email: string | null; phone: string | null } | null;
    if (!contact?.phone) {
      console.log(`skip ${lead.id} — no phone`);
      continue;
    }
    const at = Date.parse(lead.created_at as string) + 4 * DAY;
    if (at < Date.now() + 30 * 60 * 1000) {
      console.log(`skip ${lead.id} — SMS window passed`);
      continue;
    }
    const vehicle = lead.vehicles as unknown as { make: string | null; model: string | null } | null;
    const payload: AdNurturePayload = {
      shopId: lead.shop_id as string,
      leadId: lead.id as string,
      contactId: (lead.contact_id as string) ?? null,
      email: contact.email ?? "",
      firstName: contact.first_name ?? "there",
      vehicleLabel: [vehicle?.make, vehicle?.model].filter(Boolean).join(" "),
      promoCode: "CCC10",
      promoPercentOff: 10,
      packages: [],
      bookingVehicleType: null,
      quotedAt: lead.created_at as string,
      phone: contact.phone,
    };
    planned++;
    console.log(`${APPLY ? "insert" : "plan  "} sms @ ${new Date(at).toISOString()}  lead=${lead.id} (${payload.vehicleLabel || "no vehicle"})`);
    if (APPLY) {
      try {
        await scheduleAdNurtureSms(payload, new Date(at).toISOString());
      } catch (e) {
        console.error(`  FAILED: ${(e as Error).message}`);
      }
    }
  }
  console.log(`\n${APPLY ? "Inserted" : "Would insert"} ${planned} SMS jobs.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
