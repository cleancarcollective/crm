/**
 * One-shot insert: seed the /sales/selling-guide content from the
 * user-provided Sales Helper doc. Idempotent - upserts on
 * (slug, coalesce(shop_id::text, 'global')) which matches the unique
 * index on sales_resources.
 *
 * Usage:
 *   npx tsx scripts/seed-selling-guide.ts
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

const SLUG = "selling-guide";
const TITLE = "Service Differentiators & Upsells";

const BODY = `# Service Differentiators

[Most up to date all services pricing template](https://docs.google.com/spreadsheets/d/1DdgDtOHU_ZxtMe7QUHN_M9vy2K7mPxCKNlP8c9FmLiw/edit?gid=0#gid=0)

---

## Differences between Deluxe & Premium

> Hi [Customer Name],
>
> Thanks for reaching out for a detailing estimate for your [insert vehicle make and model].
>
> We offer two main interior & exterior packages designed to suit different levels of cleaning and restoration. Both will restore most vehicles to a like-new condition (depending on how dirty they are), but the premium goes the extra step to remove deep contaminants inside and out.

Both include:

- Exterior hand wash & dry
- Wheel faces, barrels & tires cleaned
- Interior vacuum and plastics detailed
- Door jamb & window cleaning
- 3-month paint sealant applied for protection

Premium Detail includes everything in the Deluxe Detail, plus:

- Full interior shampoo (carpets, seats, mats) - really gives that new-car feel and removes staining.
- Clay bar treatment for paint decontamination - helps remove the embedded contaminants such as tar and brake dust/iron (what turns purple) through friction. Leaves the paint feeling smoother and looking glossier. Also helps remove black spots (stuck-on lichen) and other contaminants.
- Engine bay cleaning
- Trim restoration (restores faded plastic trim to a black shiny look)
- Basic scratch & scuff removal to remove obvious minor scratches or parking damage such as paint transfer.

---

## INTERIOR SERVICES - HOW TO SELL THEM

Core difference:
- **Deluxe** = Deep clean
- **Premium** = Restoration-level clean

### Deluxe Interior - When to Sell It

Best for:
- Semi-regular clients
- Vehicles cleaned within last 3-6 months
- Light dirt, crumbs, basic dust
- People selling soon and just want it tidy
- Budget-conscious customers

Position it as:
> "A full reset of the interior without going into heavy shampooing."

What it actually does:
- Thorough vacuum
- Plastics cleaned + protected
- Crevices detailed
- Windows and jambs done

Key sales angle: Detail + value. Makes the car feel clean again without the extra labour of extraction.

**Upgrade trigger phrases:**
- "There are a few stains but nothing crazy"
- "It smells a bit musty"
- "Kids spilled drinks"
- "Dog hair + sand embedded"

That's your Premium lead.

### Premium Interior - When to Sell It

Best for:
- Stains
- Spills
- Dog hair embedded in carpet
- Odour issues
- Vehicles not cleaned in 6-12+ months
- Pre-sale where buyer will inspect closely

Position it as:
> "This is the one that actually removes the staining and extracts the dirt from inside the fabric."

Key difference: Shampoo + extraction + deodorising.

**Upsell opportunities:**
- Fabric/leather protection after extraction (newer cars)
- Add exterior Deluxe if interior is already Premium (easy combo upsell)

---

## EXTERIOR SERVICES - HOW TO SELL THEM

Core difference:
- **Deluxe** = Wash + 3-month protection
- **Premium** = Decontamination + smoother paint

### Deluxe Exterior - When to Sell It

Best for:
- Regular clients
- Cars already ceramic coated
- New-ish vehicles in decent condition
- People just wanting shine and protection
- Budget-conscious customers

Position it as:
> "A proper hand wash with real protection that won't damage your paint - not a drive-through wash."

Value anchor: 3-month sealant and long-lasting tire dressing included + door jambs and windows. That's a key differentiator.

### Premium Exterior - When to Sell It

Best for:
- Rough-feeling paint
- Tree sap / industrial fallout
- Cars that haven't been detailed in 6+ months
- Customers saying "the paint feels gritty"

Position it as:
> "This removes bonded contamination - not just surface dirt."

Key difference: Clay + full decon.

**Important:** Premium does NOT remove swirls. Be clear on that. It smooths paint but doesn't correct defects.

**Upsell trigger phrases:**
- "There are scratches / swirls" -> Move to Paint Correction conversation.
- "I want long-term protection" -> Move to Ceramic.

---

## PAINT CORRECTION - HOW TO SELL IT

Core difference:
- **1-Step** = Enhancement
- **2-Step** = Restoration

### 1-Step Correction - When to Sell

Best for:
- Daily drivers
- Light swirls
- Customers who want big improvement without chasing perfection
- Pre-ceramic prep for average cars
- Pre-sale detail for nicer cars / bigger budget

Position it as:
> "Major visual upgrade without going crazy on cost."

More bang for buck than a Premium Detail for just a bit more cost (assuming interior is being quoted as well).

Removes: Up to 90% of light defects.

This is your volume seller.

### 2-Step Correction - When to Sell

Best for:
- Black cars
- Enthusiasts
- Near-new vehicles
- Show-level expectations
- Customers who say "I want it perfect"

Position it as:
> "This is where we chase maximum clarity and depth."

**Important:** Only sell 2-step when expectations justify it. It's time-heavy.

**Upsell strategy:** Correction should naturally lead into Ceramic:
> "If we're correcting the paint, it makes sense to lock it in."

---

## CERAMIC COATING - HOW TO SELL IT

Core difference:
- **Bronze** = Entry protection
- **Silver** = Balanced value
- **Gold** = Long-term investment

Always position ceramic as: long-term protection + easier maintenance + resale value boost.

### Bronze - 1 Year

Sell when:
- Customer unsure about commitment
- Older vehicle
- Budget sensitive
- Planning to sell in 1-2 years

Position it as:
> "Great entry into ceramic without long-term spend."

### Silver - 3 Year

**This is your sweet spot.**

Sell when:
- Daily driver
- Mid-range or new vehicle
- Customer wants solid protection but not max price
- Most families

Position it as:
> "Best balance of protection, longevity, and value."

### Gold - 5 Year

Sell when:
- Brand new vehicles
- High-value vehicles
- Long-term owners
- Customers saying "I just bought this and want to protect it properly"
- Chasing maximum gloss / ease of cleaning / durability

Position it as:
> "This is the set-and-forget option."

**Important:** All coatings include a company-backed warranty - that's a trust lever.

**Ceramic + correction combos are good money.** Consider offering 15-30% off the correction depending on which coating is booked, and how easy the sale is. E.g. 30% off correction when booked with Gold, 15% when booked with Bronze.

---

## HOW TO TRANSITION BETWEEN SERVICES

**Interior -> Exterior**
> "If we're already restoring the inside, it might make sense to reset the outside too."

**Exterior Premium -> Correction**
> "If you're wanting that swirl-free finish, that's where correction comes in."

**Correction -> Ceramic**
> "No point correcting and leaving it unprotected."

**Ceramic -> Maintenance Plan**
> "To protect your investment, we recommend scheduled maintenance washes."

---

## QUALIFYING QUESTIONS YOUR TEAM SHOULD ASK

**Interior:**
- Any stains?
- Any smells?
- Kids/pets?
- Last time it was detailed?

**Exterior:**
- Does the paint feel rough?
- Are you seeing swirl marks?
- Is the vehicle ceramic coated already?

**Ceramic:**
- How long are you keeping the vehicle?
- Is it garaged?
- Is this a new purchase?

**Correction:**
- Are you chasing improvement or perfection?
- Is it a darker colour?

---

## MARGIN PROTECTION RULES

1. If stains are mentioned -> Lean Premium Interior
2. If scratches are mentioned -> Talk correction early
3. Never promise scratch removal unless quoting correction
4. Ceramic without correction is fine - but manage expectations

---

# Upsells

### Headlight restoration
Useful upsell anytime headlights are faded (older cars). Feel free to discount $20-30 if they have booked another service, or use as a free bonus for $800+ services.

### Carpet, seat and/or floor mat shampoos
Perfect way to upsell from a Deluxe Interior, even if it's just 1-2 seats or a section of carpet.

### Kids' seat shampoo
Parents want their kids in a safe and clean environment. Lean on that when selling the seat shampoo.

### Scratch & scuff / paint transfer removal
This one is hard to manage expectations. Paint transfer that comes off easily is fine, but sometimes people have unrealistic expectations about removing deep scratches. Quote conservatively.
`;

(async () => {
  const supabase = getSupabaseAdminClient();

  // Upsert via two-step (Supabase JS doesn't expose the conflict target
  // expression directly): try insert; if duplicate, update by slug.
  const { error: insertError } = await supabase.from("sales_resources").insert({
    slug: SLUG,
    type: "guide",
    title: TITLE,
    body_markdown: BODY,
    display_order: 50, // sorts above objection cards (default 100) but below the script
    shop_id: null,
  });

  if (insertError && insertError.code === "23505") {
    // Duplicate - update existing
    const { error: updateError } = await supabase
      .from("sales_resources")
      .update({ title: TITLE, body_markdown: BODY, type: "guide" })
      .eq("slug", SLUG)
      .is("shop_id", null);
    if (updateError) {
      console.error("Update failed:", updateError);
      process.exit(1);
    }
    console.log("Updated existing selling-guide row.");
  } else if (insertError) {
    console.error("Insert failed:", insertError);
    process.exit(1);
  } else {
    console.log("Inserted new selling-guide row.");
  }
})();
