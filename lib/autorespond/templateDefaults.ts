/**
 * Default template seeds. Used to:
 *   1. Bootstrap the email_templates table if empty (via seed API)
 *   2. Fall back when a DB template is missing (during migration)
 *
 * Template syntax: {{variable_name}} — replaced at render time.
 * Available variables per template key:
 *   inside_out:      name, vehicle, deluxe_price, premium_price
 *   interior_only:   name, vehicle, deluxe_interior_price, premium_interior_price
 *   exterior_only:   name, vehicle, deluxe_exterior_price, premium_exterior_price
 *   ceramic:         name, vehicle, bronze_price, silver_price, gold_price
 *   paint_correction: name, vehicle, one_step_price, two_step_price
 *   other:           name, vehicle
 */

import type { TemplateKey } from "./templates";

export type TemplateDefault = {
  template_key: TemplateKey;
  variant: string;
  name: string;
  subject: string;
  body_text: string;
};

// CTA without a URL — links in transactional emails were pushing them
// to Gmail's Promotions tab. Customers can simply reply to lock in.
const CTA = `Just reply to this email if you'd like to lock in a slot or have any other questions.`;

export const TEMPLATE_DEFAULTS: TemplateDefault[] = [
  {
    template_key: "inside_out",
    variant: "A",
    name: "Inside & Out — Default",
    subject: "Detailing estimate for your {{vehicle}}",
    body_text: `Hi {{name}},

Thanks for reaching out for a detailing estimate for your {{vehicle}}.
We offer two main interior & exterior packages designed to suit different levels of cleaning and restoration:

Deluxe Detail -- {{deluxe_price}} (approx. 3.5-4 hours)
- Exterior hand wash & dry
- Wheel faces, barrels & tires cleaned
- Interior vacuum and plastics detailed
- Door jamb & window cleaning
- 3-month paint sealant applied for protection

Premium Detail -- {{premium_price}} (approx. 5.5-6.5 hours)
- Includes everything in the Deluxe Detail, plus:
- Full interior shampoo (carpets, seats, mats)
- Clay bar treatment for paint decontamination
- Engine bay cleaning
- 6-month paint sealant applied

We can also tailor the package, for example, by just shampooing the seats or skipping the engine bay.

If you're looking for the ultimate result, we also offer paint correction (removes light swirls & scratches) and ceramic coatings (2-5+ year protection). Happy to include pricing for those if you're interested.

Please let me know if you have any questions, or if you'd like to go ahead.
${CTA}

Cheers,
Max`,
  },
  {
    template_key: "interior_only",
    variant: "A",
    name: "Interior Only — Default",
    subject: "Interior detailing estimate for your {{vehicle}}",
    body_text: `Hi {{name}},

Thanks for your inquiry about an interior detail for your {{vehicle}}.
Here are our two main interior packages:

Deluxe Interior -- {{deluxe_interior_price}} (approx. 2.5-3 hours)
- Full interior vacuum (carpets, mats, seats)
- Crevice detail for all surfaces
- Interior plastics cleaned & protected
- Door jambs & interior windows cleaned

Premium Interior -- {{premium_interior_price}} (approx. 3.5-4.5 hours)
- Includes everything in the Deluxe Interior, plus:
- Shampoo & extraction of all seats, carpets, and mats
- Double vacuum & stain extraction
- Interior deodorising treatment

We can also customise the job, for example, if you only want the seats shampooed, we can adjust pricing accordingly.
If you're interested in long-term protection, we can add interior fabric/leather protection coatings to keep surfaces cleaner for longer.

Please let me know if you have any questions, or if you'd like to go ahead.
${CTA}

Cheers,
Max`,
  },
  {
    template_key: "exterior_only",
    variant: "A",
    name: "Exterior Only — Default",
    subject: "Exterior detailing estimate for your {{vehicle}}",
    body_text: `Hi {{name}},

Thanks for getting in touch about an exterior clean for your {{vehicle}}.
We offer two main exterior hand wash services:

Deluxe Exterior -- {{deluxe_exterior_price}} (approx. 1.5-2 hours)
- Exterior hand wash & dry
- Wheel faces, barrels & tires cleaned
- Windows & mirrors cleaned
- Wax/paint sealant applied for 3 months of protection

Premium Exterior -- {{premium_exterior_price}} (approx. 2.5-3 hours)
- Includes everything in Deluxe, plus:
- Clay bar treatment to remove bonded contaminants
- Full paint decontamination for a smoother, glossier finish

If your paint has visible swirls or scratches, we also offer paint correction and ceramic coating packages for longer-term protection -- happy to provide details if you'd like.

Please let me know if you have any questions, or if you'd like to go ahead.
${CTA}

Cheers,
Max`,
  },
  {
    template_key: "ceramic",
    variant: "A",
    name: "Ceramic Coating — Default",
    subject: "Ceramic coating estimate for your {{vehicle}}",
    body_text: `Hi {{name}},

Thanks for reaching out about ceramic coating protection for your {{vehicle}}.

We are CarPro authorized installers and offer three levels of coating to suit different vehicles and budgets:

Bronze Package -- {{bronze_price}}
- 1-year protection
- Gloss enhancement & strong hydrophobic properties

Silver Package -- {{silver_price}}
- 3-year protection
- Added chemical resistance & easy-clean surface

Gold Package -- {{gold_price}}
- 5-year protection (backed by our company warranty)
- Maximum gloss retention, hardness improvement & top-tier hydrophobic performance

All coatings include a full surface prep (wash, decontamination, and spot polishing if needed).

Please let me know if you have any questions, or if you'd like to go ahead.
${CTA}

Cheers,
Max`,
  },
  {
    template_key: "paint_correction",
    variant: "A",
    name: "Paint Correction — Default",
    subject: "Paint correction estimate for your {{vehicle}}",
    body_text: `Hi {{name}},

Thanks for reaching out about paint correction for your {{vehicle}}.

Paint correction removes light swirls, oxidation, and scratches, dramatically improving gloss and depth.

1-Step Correction -- {{one_step_price}}
- Removes up to 90% of light swirls & micro-marring
- Great for most daily drivers

2-Step Correction -- {{two_step_price}}
- Removes deeper scratches and watermarks
- Maximises clarity and reflection for high-end results

Correction is the perfect preparation step before applying a ceramic coating, ensuring a flawless, protected finish.

Please let me know if you have any questions, or if you'd like to go ahead.
${CTA}

Cheers,
Max`,
  },
  {
    template_key: "other",
    variant: "A",
    name: "Other / Fallback — Default",
    subject: "Estimate request received for your {{vehicle}}",
    body_text: `Hi {{name}},

Thanks for reaching out about your {{vehicle}}.
We've received your request and will come back to you shortly with the right options and pricing.

${CTA}

Cheers,
Max`,
  },
  {
    template_key: "lead_followup_3day",
    variant: "A",
    name: "Follow-up — 3 days after quote",
    subject: "Any questions about your {{vehicle}} estimate?",
    body_text: `Hi {{name}},

Just following up on the detailing estimate I sent through a few days ago for your {{vehicle}}.

Happy to answer any questions about the packages, help pick the right option, or tweak things to suit your budget. Most of our bookings go 1-2 weeks out so worth locking in a slot if you're keen.

Just reply to this email and I'll get you booked in.

Cheers,
Max`,
  },
  {
    template_key: "lead_followup_7day",
    variant: "A",
    name: "Follow-up — 7 days after quote (final)",
    subject: "Still keen on a detail for your {{vehicle}}?",
    body_text: `Hi {{name}},

Just one last check-in. Let me know if you're still keen for a detail on your {{vehicle}} — happy to help with timing, any questions, or adjusting the package to suit.

Otherwise no worries, I'll leave you be. Feel free to reach out anytime.

Cheers,
Max`,
  },
];

/**
 * Variables available per template_key — used for the editor UI to show
 * the user which variables are safe to reference.
 */
export const TEMPLATE_VARIABLES: Record<TemplateKey, { key: string; label: string }[]> = {
  inside_out: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
    { key: "deluxe_price", label: "Deluxe Detail price (e.g. $370 + GST)" },
    { key: "premium_price", label: "Premium Detail price" },
  ],
  interior_only: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
    { key: "deluxe_interior_price", label: "Deluxe Interior Detail price" },
    { key: "premium_interior_price", label: "Premium Interior Detail price" },
  ],
  exterior_only: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
    { key: "deluxe_exterior_price", label: "Deluxe Exterior Detail price" },
    { key: "premium_exterior_price", label: "Premium Exterior Detail price" },
  ],
  ceramic: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
    { key: "bronze_price", label: "Ceramic Bronze (1 Year) price" },
    { key: "silver_price", label: "Ceramic Silver (2 Year) price" },
    { key: "gold_price", label: "Ceramic Gold (5 Year) price" },
  ],
  paint_correction: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
    { key: "one_step_price", label: "Paint Correction 1-Step price" },
    { key: "two_step_price", label: "Paint Correction 2-Step price" },
  ],
  other: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
  ],
  lead_followup_3day: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
  ],
  lead_followup_7day: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
  ],
};

export const TEMPLATE_KEY_LABELS: Record<TemplateKey, string> = {
  inside_out: "Inside & Out (Full Detail)",
  interior_only: "Interior Only",
  exterior_only: "Exterior Only",
  ceramic: "Ceramic Coating",
  paint_correction: "Paint Correction",
  other: "Other / Fallback",
  lead_followup_3day: "Follow-up: 3 days after quote",
  lead_followup_7day: "Follow-up: 7 days after quote",
};
