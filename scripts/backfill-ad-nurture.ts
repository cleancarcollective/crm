/**
 * One-off backfill: schedule the ad-lead nurture drip for road-trip promo
 * leads that arrived BEFORE the nurture code shipped (2026-07-05).
 *
 * Touch times are relative to each lead's created_at (+22h / +3d / +6d);
 * touches already in the past are skipped, and a lead whose whole window
 * has lapsed gets just the day-6 last-call at now+2h. Idempotent — leads
 * that already have any ad_nurture job are skipped.
 *
 * Prices were computed by the quote at intake but not persisted per-lead,
 * so backfilled payloads carry packages: [] — the renderers fall back to
 * "the full breakdown is in the estimate email".
 *
 * Usage:
 *   npx tsx scripts/backfill-ad-nurture.ts          # dry run (prints plan)
 *   npx tsx scripts/backfill-ad-nurture.ts --apply  # insert jobs
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
import type { AdNurturePayload } from "@/lib/autorespond/adNurture";

const APPLY = process.argv.includes("--apply");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Mirrors LANDING_PROMOS in processLead.ts — both road-trip pages are CCC10.
const PROMO = { code: "CCC10", percentOff: 10 };

async function main() {
  const supabase = getSupabaseAdminClient();

  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id, shop_id, contact_id, created_at, status, email_bounced_at, landing_url, contacts(first_name, email), vehicles(make, model)"
    )
    .ilike("landing_url", "%road-trip%")
    .eq("status", "sent")
    .is("email_bounced_at", null);
  if (error) throw error;

  // Leads that already have nurture jobs (idempotency)
  const { data: existing } = await supabase
    .from("scheduled_email_jobs")
    .select("lead_id")
    .like("job_type", "ad_nurture%");
  const alreadyScheduled = new Set((existing ?? []).map((j) => j.lead_id as string));

  let planned = 0;
  for (const lead of leads ?? []) {
    if (alreadyScheduled.has(lead.id as string)) {
      console.log(`skip ${lead.id} — nurture already scheduled`);
      continue;
    }
    const contact = lead.contacts as unknown as { first_name: string | null; email: string | null } | null;
    if (!contact?.email) {
      console.log(`skip ${lead.id} — no contact email`);
      continue;
    }
    const vehicle = lead.vehicles as unknown as { make: string | null; model: string | null } | null;
    const created = Date.parse(lead.created_at as string);
    const now = Date.now();

    const payload: AdNurturePayload = {
      shopId: lead.shop_id as string,
      leadId: lead.id as string,
      contactId: (lead.contact_id as string) ?? null,
      email: contact.email,
      firstName: contact.first_name ?? "there",
      vehicleLabel: [vehicle?.make, vehicle?.model].filter(Boolean).join(" "),
      promoCode: PROMO.code,
      promoPercentOff: PROMO.percentOff,
      packages: [], // prices not persisted pre-ship; renderers fall back gracefully
      bookingVehicleType: null,
      quotedAt: new Date(created).toISOString(),
    };

    const touches: Array<{ jobType: string; at: number }> = [
      { jobType: "ad_nurture_day1", at: created + 22 * HOUR },
      { jobType: "ad_nurture_day3", at: created + 3 * DAY },
      { jobType: "ad_nurture_day6", at: created + 6 * DAY },
    ].filter((t) => t.at > now + 15 * 60 * 1000);

    if (touches.length === 0) {
      touches.push({ jobType: "ad_nurture_day6", at: now + 2 * HOUR });
    }

    for (const t of touches) {
      planned++;
      const when = new Date(t.at).toISOString();
      console.log(`${APPLY ? "insert" : "plan  "} ${t.jobType} @ ${when}  lead=${lead.id} (${payload.vehicleLabel || "no vehicle"})`);
      if (APPLY) {
        const { error: insErr } = await supabase.from("scheduled_email_jobs").insert({
          shop_id: payload.shopId,
          lead_id: payload.leadId,
          contact_id: payload.contactId,
          booking_id: null,
          job_type: t.jobType,
          template_key: t.jobType,
          scheduled_for: when,
          payload_json: payload,
          status: "pending",
        });
        if (insErr) console.error(`  FAILED: ${insErr.message}`);
      }
    }
  }
  console.log(`\n${APPLY ? "Inserted" : "Would insert"} ${planned} jobs for ${(leads ?? []).length} candidate leads.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
