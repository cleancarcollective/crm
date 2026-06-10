/**
 * Append add-on / upsell offerings to service_offerings. Flat-priced
 * (not per-vehicle), grouped under category "Add-on". Idempotent on
 * service_id - deletes existing add-on rows then re-inserts.
 *
 * Usage: npx tsx scripts/seed-addon-offerings.ts
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
loadEnv(".env.local"); loadEnv(".env.vercel.local");

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

// Flat-price add-ons - one "All vehicles" price tier.
function flat(price: number, minutes: number) {
  return { "All vehicles": { price, duration_minutes: minutes } };
}

const ADDONS = [
  {
    service_id: "shampoo-carpet",
    display_name: "Shampoo carpet & floor mats",
    rank: 20,
    pricing_table: flat(60, 24),
    description: "Hot-water extraction of carpets + mats (per row).",
    selling_points: "The easiest upsell off a Deluxe Interior - even if it's just one row or a section of carpet. Trigger: \"a couple of stains\" or musty smell.",
    notes: "Priced per row. Quote multiple rows accordingly.",
  },
  {
    service_id: "shampoo-seats",
    display_name: "Shampoo seats",
    rank: 21,
    pricing_table: flat(60, 24),
    description: "Hot-water extraction of seats (per row).",
    selling_points: "Pairs with carpet shampoo. Great upsell when a customer mentions spills or stains but doesn't want a full Premium Interior.",
    notes: "Priced per row.",
  },
  {
    service_id: "kids-seat",
    display_name: "Kids car seat shampoo",
    rank: 22,
    pricing_table: flat(30, 12),
    description: "Sanitise + clean one child seat.",
    selling_points: "Lean on safety + hygiene - parents want their kids in a clean environment. Cheap yes, but easy to add and parents say yes readily.",
    notes: "Per seat.",
  },
  {
    service_id: "pet-hair",
    display_name: "Excess pet hair removal",
    rank: 23,
    pricing_table: flat(80, 45),
    description: "Deep pet-hair removal (per hour basis).",
    selling_points: "Included in Premium Interior; an $80 add-on to a Deluxe. Trigger: \"dog hair everywhere\" / \"hair embedded in the carpet\".",
    notes: "Per hour - heavy cases may run longer, manage expectations.",
  },
  {
    service_id: "engine-bay",
    display_name: "Engine Bay Detail",
    rank: 24,
    pricing_table: flat(55, 30),
    description: "Deep clean + dress engine bay plastics.",
    selling_points: "Included in Premium Detail; a $55 add-on otherwise. Good pre-sale add - a clean bay reassures buyers.",
    notes: "",
  },
  {
    service_id: "headliner",
    display_name: "Headliner cleaning",
    rank: 25,
    pricing_table: flat(80, 36),
    description: "Steam clean delicate roof-lining fabric.",
    selling_points: "Upsell when there are marks/stains on the roof lining (smoke, food, hands). Often overlooked - point it out.",
    notes: "Delicate fabric - steam only.",
  },
  {
    service_id: "scratch-removal",
    display_name: "Scratch & scuff / paint-transfer removal",
    rank: 26,
    pricing_table: flat(75, 30),
    description: "Spot correction on specific scratches / scuffs / paint transfer.",
    selling_points: "Easy win for paint transfer that wipes off. CAUTION: manage expectations hard - people often want deep scratches gone, which needs full Paint Correction.",
    notes: "Never promise deep-scratch removal here - that's a correction conversation.",
  },
  {
    service_id: "ceramic-sealant",
    display_name: "6 Month Ceramic Sealant",
    rank: 27,
    pricing_table: flat(60, 30),
    description: "SiO2 booster for the paint - stronger + longer than the standard 3-month sealant.",
    selling_points: "Upsell from the standard 3-month sealant for customers who want longer protection but aren't ready for a full ceramic coating.",
    notes: "",
  },
  {
    service_id: "valet-pickup",
    display_name: "Valet Pickup",
    rank: 28,
    pricing_table: flat(40, 30),
    description: "We collect the vehicle.",
    selling_points: "Convenience sell for busy customers / no spare day. Pairs naturally with drop-off for a full door-to-door service.",
    notes: "Confirm address + keys handover.",
  },
  {
    service_id: "valet-dropoff",
    display_name: "Valet Drop-off",
    rank: 29,
    pricing_table: flat(40, 30),
    description: "We return the vehicle.",
    selling_points: "Bundle with pickup for office workers / parents - removes the \"I can't get there\" objection entirely.",
    notes: "",
  },
  {
    service_id: "photos-10",
    display_name: "10 professional photos for selling",
    rank: 30,
    pricing_table: flat(50, 0),
    description: "10 pro photos of the vehicle once it's clean - for online listings.",
    selling_points: "Auto-offered on the customer booking form on any full-car package (Premium/Deluxe Detail, Premium/Deluxe Exterior). Lean on the listing angle - clean cars on Trade Me / Facebook Marketplace sell faster and for more. Cheap to add ($50) on top of a full clean. No extra booking time - we shoot while the car is drying.",
    notes: "Surfaced as an inline upsell under the full-car packages on the booking form. Don't bring it up unprompted on interior-only jobs - those get the 5-photo version below.",
  },
  {
    service_id: "photos-5",
    display_name: "5 professional photos for selling",
    rank: 31,
    pricing_table: flat(25, 0),
    description: "5 pro interior shots once it's clean - for online listings.",
    selling_points: "Auto-offered on the customer booking form whenever they select a Premium Interior or Deluxe Interior. Trigger: \"I'm getting it cleaned to sell.\" Cheap photo bundle to close the loop. No extra booking time.",
    notes: "Surfaced as an inline upsell under the interior-only packages on the booking form.",
  },
];

(async () => {
  const supabase = getSupabaseAdminClient();

  const ids = ADDONS.map((a) => a.service_id);
  // Clear existing add-on rows (idempotent re-run).
  await supabase.from("service_offerings").delete().is("shop_id", null).in("service_id", ids);

  const rows = ADDONS.map((a) => ({
    shop_id: null,
    service_id: a.service_id,
    display_name: a.display_name,
    category: "Add-on",
    popularity_rank: a.rank,
    pricing_table: a.pricing_table,
    description: a.description,
    what_included: null,
    selling_points: a.selling_points,
    notes: a.notes || null,
    is_active: true,
  }));

  const { error } = await supabase.from("service_offerings").insert(rows);
  if (error) {
    console.error("Insert failed:", error);
    process.exit(1);
  }
  console.log(`Seeded ${rows.length} add-on offerings.`);
})();
