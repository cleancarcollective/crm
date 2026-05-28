/**
 * Rebuild service_offerings to mirror the customer booking form exactly.
 * Kills the redundant "Combination" + generic "Interior/Exterior Only"
 * rows. Every offering now maps 1:1 to a booking-form service with the
 * real per-vehicle pricing.
 *
 * Usage: npx tsx scripts/reseed-service-offerings.ts
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

type Row = { price: number; duration_minutes: number };
function pt(coupe: Row, sedan: Row, smSuv: Row, lgSuv: Row) {
  return {
    "Coupe / Hatchback": coupe,
    "Sedan / Wagon": sedan,
    "Small / Medium SUV": smSuv,
    "Large SUV / Ute": lgSuv,
  };
}

const OFFERINGS = [
  {
    service_id: "deluxe-detail",
    display_name: "Deluxe Detail",
    category: "Full Detail",
    popularity_rank: 1,
    pricing_table: pt(
      { price: 355, duration_minutes: 180 },
      { price: 370, duration_minutes: 210 },
      { price: 390, duration_minutes: 240 },
      { price: 420, duration_minutes: 270 },
    ),
    description: "Our most popular regular detail - full interior + exterior in one.",
    what_included: "- Exterior hand wash & dry\n- Wheel faces, barrels & tyres cleaned\n- Interior vacuum + plastics detailed\n- Door jambs & windows\n- 3-month paint + plastic sealant",
    selling_points: "The default for a well-maintained car or a semi-regular client. Position as \"a proper hand wash + interior reset with real 3-month protection - not a drive-through wash.\"",
    notes: "If they mention stains/smells/pets -> lean Premium. If paint feels rough -> Premium Exterior or Premium Detail.",
  },
  {
    service_id: "premium-detail",
    display_name: "Premium Detail",
    category: "Full Detail",
    popularity_rank: 2,
    pricing_table: pt(
      { price: 600, duration_minutes: 300 },
      { price: 625, duration_minutes: 330 },
      { price: 650, duration_minutes: 360 },
      { price: 700, duration_minutes: 390 },
    ),
    description: "The deep-clean / fresh-start pass. Everything in Deluxe plus decontamination + restoration.",
    what_included: "Everything in the Deluxe Detail, plus:\n- Full interior shampoo (carpets, seats, mats)\n- Clay bar paint decontamination\n- Engine bay cleaning\n- Trim restoration\n- Basic scratch & scuff / paint-transfer removal",
    selling_points: "Best for cars not detailed in 6+ months, pre-sale prep, or anyone wanting that new-car feel. Note: smooths paint but does NOT correct swirls - that's Paint Correction.",
    notes: "Starts in the morning. Anything starting after ~11am may need to stay overnight - be upfront.",
  },
  {
    service_id: "deluxe-interior",
    display_name: "Deluxe Interior",
    category: "Interior Only",
    popularity_rank: 3,
    pricing_table: pt(
      { price: 242, duration_minutes: 108 },
      { price: 258, duration_minutes: 120 },
      { price: 269, duration_minutes: 150 },
      { price: 286, duration_minutes: 180 },
    ),
    description: "A full interior reset without heavy shampooing.",
    what_included: "- Thorough vacuum\n- Plastics cleaned + protected\n- Crevices detailed\n- Windows + door jambs",
    selling_points: "Best for semi-regular clients, cars cleaned in the last 3-6 months, light dirt, or budget-conscious customers. Makes the car feel clean again without the labour of extraction.",
    notes: "Trigger to upsell Premium Interior: \"a few stains\", \"smells musty\", \"kids spilled drinks\", \"dog hair embedded\".",
  },
  {
    service_id: "premium-interior",
    display_name: "Premium Interior",
    category: "Interior Only",
    popularity_rank: 4,
    pricing_table: pt(
      { price: 379, duration_minutes: 168 },
      { price: 395, duration_minutes: 180 },
      { price: 412, duration_minutes: 204 },
      { price: 430, duration_minutes: 240 },
    ),
    description: "Restoration-level interior clean - the one that actually removes staining.",
    what_included: "Everything in Deluxe Interior, plus:\n- Full shampoo + extraction (carpets, seats, mats)\n- Stain removal\n- Deodorising",
    selling_points: "Best for stains, spills, embedded dog hair, odour issues, cars not cleaned in 6-12+ months, or pre-sale where a buyer inspects closely.",
    notes: "Easy combo upsell: add a Deluxe Exterior if they only booked interior.",
  },
  {
    service_id: "deluxe-exterior",
    display_name: "Deluxe Exterior Hand Wash",
    category: "Exterior Hand Wash",
    popularity_rank: 5,
    pricing_table: pt(
      { price: 105, duration_minutes: 60 },
      { price: 115, duration_minutes: 72 },
      { price: 120, duration_minutes: 78 },
      { price: 135, duration_minutes: 102 },
    ),
    description: "A proper hand wash with real protection.",
    what_included: "- Exterior hand wash & dry\n- Wheels, barrels & tyres\n- Door jambs + windows\n- 3-month sealant + long-lasting tyre dressing",
    selling_points: "Best for regular clients, ceramic-coated cars, newer vehicles in good condition, or budget customers who just want shine + protection. Value anchor: the 3-month sealant + jambs + windows is the differentiator vs a $20 wash.",
    notes: "",
  },
  {
    service_id: "premium-exterior",
    display_name: "Premium Exterior",
    category: "Exterior Hand Wash",
    popularity_rank: 6,
    pricing_table: pt(
      { price: 230, duration_minutes: 120 },
      { price: 235, duration_minutes: 138 },
      { price: 245, duration_minutes: 156 },
      { price: 255, duration_minutes: 168 },
    ),
    description: "Removes bonded contamination, not just surface dirt.",
    what_included: "Everything in Deluxe Exterior, plus:\n- Clay bar treatment\n- Full decontamination (tar, iron, fallout)",
    selling_points: "Best for rough-feeling paint, tree sap / industrial fallout, or cars not detailed in 6+ months. Important: smooths paint but does NOT remove swirls - that's Paint Correction.",
    notes: "Trigger phrases: \"scratches/swirls\" -> Paint Correction. \"long-term protection\" -> Ceramic.",
  },
  {
    service_id: "1-step-correction",
    display_name: "1-Step Paint Correction",
    category: "Paint Correction",
    popularity_rank: 7,
    pricing_table: pt(
      { price: 550, duration_minutes: 258 },
      { price: 600, duration_minutes: 300 },
      { price: 625, duration_minutes: 360 },
      { price: 650, duration_minutes: 420 },
    ),
    description: "Enhancement - removes up to 90% of light defects.",
    what_included: "- Machine polish (single stage)\n- Removes light swirls + oxidation\n- Major visual upgrade",
    selling_points: "The volume seller. Best for daily drivers, light swirls, pre-ceramic prep, or pre-sale on nicer cars. \"Major visual upgrade without going crazy on cost.\"",
    notes: "Naturally leads into Ceramic: \"no point correcting and leaving it unprotected.\" Offer 15-30% off correction when booked with a coating.",
  },
  {
    service_id: "2-step-correction",
    display_name: "2-Step Paint Correction",
    category: "Paint Correction",
    popularity_rank: 8,
    pricing_table: pt(
      { price: 900, duration_minutes: 480 },
      { price: 950, duration_minutes: 540 },
      { price: 975, duration_minutes: 600 },
      { price: 1000, duration_minutes: 660 },
    ),
    description: "Restoration - chasing maximum clarity and depth.",
    what_included: "- Two-stage machine correction\n- Removes deeper defects + swirls\n- Show-level finish",
    selling_points: "Only sell when expectations justify it - it's time-heavy. Best for black cars, enthusiasts, near-new vehicles, or \"I want it perfect\" customers.",
    notes: "Always pair with Ceramic. Manage expectations - even 2-step won't fix every defect on a rough car.",
  },
  {
    service_id: "ceramic-bronze",
    display_name: "Ceramic Coating - Bronze (1 Year)",
    category: "Ceramic Coating",
    popularity_rank: 9,
    pricing_table: pt(
      { price: 637.5, duration_minutes: 72 },
      { price: 637.5, duration_minutes: 72 },
      { price: 680, duration_minutes: 120 },
      { price: 680, duration_minutes: 120 },
    ),
    description: "Entry-level ceramic protection, 1-year warranty.",
    what_included: "- Single-layer ceramic coating\n- 1-year company-backed warranty\n- Easier washing + added gloss",
    selling_points: "Best when the customer is unsure about commitment, has an older vehicle, is budget-sensitive, or plans to sell in 1-2 years. \"Great entry into ceramic without long-term spend.\"",
    notes: "Always recommend correction or at least a Premium Exterior decon BEFORE coating. Quote a consultation if paint condition is unknown.",
  },
  {
    service_id: "ceramic-silver",
    display_name: "Ceramic Coating - Silver (3 Year)",
    category: "Ceramic Coating",
    popularity_rank: 10,
    pricing_table: pt(
      { price: 833, duration_minutes: 120 },
      { price: 833, duration_minutes: 120 },
      { price: 892.5, duration_minutes: 150 },
      { price: 892.5, duration_minutes: 150 },
    ),
    description: "The sweet spot - best balance of protection, longevity, and value.",
    what_included: "- Multi-layer ceramic coating\n- 3-year company-backed warranty\n- Strong gloss + hydrophobics",
    selling_points: "Your default ceramic recommendation. Best for daily drivers, mid-range or new vehicles, and most families who want solid protection without max spend.",
    notes: "",
  },
  {
    service_id: "ceramic-gold",
    display_name: "Ceramic Coating - Gold (5 Year)",
    category: "Ceramic Coating",
    popularity_rank: 11,
    pricing_table: pt(
      { price: 1020, duration_minutes: 120 },
      { price: 1020, duration_minutes: 120 },
      { price: 1190, duration_minutes: 150 },
      { price: 1190, duration_minutes: 150 },
    ),
    description: "The set-and-forget option, 5-year warranty.",
    what_included: "- Premium multi-layer coating\n- 5-year company-backed warranty\n- Maximum gloss, durability + ease of cleaning",
    selling_points: "Best for brand-new or high-value vehicles, long-term owners, and \"I just bought this and want to protect it properly\" customers.",
    notes: "Pair with correction for max effect - offer up to 30% off the correction when booked with Gold.",
  },
  {
    service_id: "headlight-restoration",
    display_name: "Headlight Restoration",
    category: "Add-on",
    popularity_rank: 12,
    pricing_table: pt(
      { price: 105, duration_minutes: 45 },
      { price: 105, duration_minutes: 45 },
      { price: 105, duration_minutes: 45 },
      { price: 105, duration_minutes: 45 },
    ),
    description: "Restores faded/yellowed headlights.",
    what_included: "- Sand + polish + UV seal\n- 2-year warranty",
    selling_points: "Easy add-on whenever headlights are faded (older cars). Discount $20-30 if booked with another service, or throw in free on $800+ jobs.",
    notes: "",
  },
];

(async () => {
  const supabase = getSupabaseAdminClient();

  // Wipe the global (shop_id IS NULL) offerings and rebuild. Shop-specific
  // rows (if any were ever added) are left untouched.
  const { error: delErr } = await supabase.from("service_offerings").delete().is("shop_id", null);
  if (delErr) {
    console.error("Delete failed:", delErr);
    process.exit(1);
  }

  const rows = OFFERINGS.map((o) => ({
    shop_id: null,
    service_id: o.service_id,
    display_name: o.display_name,
    category: o.category,
    popularity_rank: o.popularity_rank,
    pricing_table: o.pricing_table,
    description: o.description,
    what_included: o.what_included,
    selling_points: o.selling_points,
    notes: o.notes || null,
    is_active: true,
  }));

  const { error: insErr } = await supabase.from("service_offerings").insert(rows);
  if (insErr) {
    console.error("Insert failed:", insErr);
    process.exit(1);
  }
  console.log(`Reseeded ${rows.length} service offerings.`);
})();
